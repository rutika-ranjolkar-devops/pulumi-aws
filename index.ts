import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import { SubnetType } from "@pulumi/awsx/ec2";
import * as eks from "@pulumi/eks";
import * as iam from "./iam";
import assert = require("assert");
import * as k8s from "@pulumi/kubernetes";
import { LBControllerPolicy } from "./iamPolicy";

const projectName = pulumi.getProject();
const tags = { "Status": "Demo", "Project": "pulumi-aws"};
const node_group_role = iam.createRole("eks-node-group-role-NEW");

// Allocate a new VPC with the default settings.
const vpc = new awsx.ec2.Vpc("eks-vpc", {
    tags: {"Name": `${projectName}`, ...tags},
    cidrBlock: "10.0.0.0/16",
    numberOfAvailabilityZones: 3,
    subnetSpecs: [
                {type: SubnetType.Public, tags: {"kubernetes.io/role/elb": "1", ...tags}},
                {type: SubnetType.Private, tags: {"kubernetes.io/role/internal-elb": "1", ...tags}},
            ],
    subnetStrategy: "Auto",
});

// Role for EKS cluster
const eksRole = new aws.iam.Role("eksClusterRole-NEW", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "eks.amazonaws.com" }),
});

const eksPolicyAttachment = new aws.iam.RolePolicyAttachment("eksPolicyAttachment", {
    role: eksRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
});


const eksAmazonEKSVPCResourceControllerPolicyAttachment = new aws.iam.RolePolicyAttachment("eksAmazonEKSVPCResourceControllerPolicyAttachment", {
    role: eksRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController", // This ARN is for the AmazonEKSVPCResourceController policy
});

// New EKS Cluster
const cluster = new eks.Cluster("at-cluster", {
    vpcId: vpc.vpcId,
    privateSubnetIds: vpc.privateSubnetIds,
    roleMappings: [{
            roleArn: eksRole.arn, // Use the role created above
            groups: ["system:masters"],
            username: "admin",
        }],
        serviceRole: eksRole,
        createOidcProvider: true,
    tags,
});

export const kubeconfig = cluster.kubeconfig;
export const clusterName = cluster.eksCluster.name;

// Export the cluster OIDC provider URL.
if (!cluster?.core?.oidcProvider) {
    throw new Error("Invalid cluster OIDC provider URL");
}
const clusterOidcProvider = cluster.core.oidcProvider;
export const clusterOidcProviderUrl = clusterOidcProvider.url;

// Setup Pulumi Kubernetes provider.
const provider = new k8s.Provider("eks-k8s", {
    kubeconfig: kubeconfig.apply(JSON.stringify),
});

// This is the namespace where the AWS Load Balancer Controller will be installed.
const namespace = new k8s.core.v1.Namespace("aws-loadbalancer", {
    metadata: {
        name: "kube-system", // typically installed in the kube-system namespace
    },
}, { provider: cluster.provider });

// Create the new IAM policy for the Service Account using the AssumeRoleWebWebIdentity action.
const saName = "at-sa";
const saAssumeRolePolicy = pulumi.all([clusterOidcProviderUrl, clusterOidcProvider.arn, namespace.metadata.name]).apply(([url, arn, namespace]) => aws.iam.getPolicyDocument({
    statements: [{
        actions: ["sts:AssumeRoleWithWebIdentity"],
        conditions: [
        {
            test: "StringEquals",
            values: [`system:serviceaccount:${namespace}:${saName}`,],
            variable: `${url.replace("https://", "")}:sub`,

        },
        {
            test: "StringEquals",
            values: [`sts.amazonaws.com`],
            variable: `${url.replace("https://", "")}:aud`,

        }
        ],
        effect: "Allow",
        principals: [{
            identifiers: [arn],
            type: "Federated",
        }],
    }],
}));

const saRole = new aws.iam.Role(saName, {
    assumeRolePolicy: saAssumeRolePolicy.json,
});

// RBAC setup for the AWS Load Balancer Controller.
const sa = new k8s.core.v1.ServiceAccount(saName, {
    metadata: {
        namespace: namespace.metadata.name,
        name: saName,
        annotations: {
            "eks.amazonaws.com/role-arn": saRole.arn,
        },
    },
}, { provider: provider});

const customPolicy = new aws.iam.Policy("customPolicy", {
    name: "CustomPolicy",
    description: "Custom IAM policy for Pulumi",
    policy: LBControllerPolicy,
});

const saS3Rpa = new aws.iam.RolePolicyAttachment(saName, {
    policyArn: customPolicy.arn,
    role: saRole,
});

const instanceProfile = new aws.iam.InstanceProfile("InstanceProfile", {
    role: node_group_role,
});

const selfManagedNodeGroup = new eks.NodeGroup("self-managed-nodegroup", {
    cluster: cluster.core,
    instanceType: "t3.medium",
    desiredCapacity: 2,
    minSize: 1,
    maxSize: 3,
    labels: { "on-demand": "true" },
    instanceProfile: instanceProfile,
});

// Create a new ECR repository
const repo = new aws.ecr.Repository("myrepository", {});

// Install the AWS Load Balancer Controller.
// Install a specific version compatible with our EKS cluster version.
const awsLoadBalancerControllerVersion = "1.7.1";



// Install the Helm chart for the AWS Load Balancer Controller.
const chart = new k8s.helm.v3.Chart("aws-loadbalancer-controller", {
    namespace: namespace.metadata.name,
    chart: "aws-load-balancer-controller",
    version: awsLoadBalancerControllerVersion,
    fetchOpts: {
        repo: "https://aws.github.io/eks-charts",
    },
    values: {
        clusterName: clusterName,
        serviceAccount: {
            create: false,
            name: saName,
        },
    }
}, { provider: cluster.provider });


export const repositoryUrl = repo.repositoryUrl;
export const vpcId = vpc.vpcId;

const deploymentResource = chart.getResource("apps/v1/Deployment", "aws-loadbalancer-controller");
export const awsLoadBalancerControllerNamespace = namespace.metadata.name;

export const awsLoadBalancerControllerName = pulumi.output(deploymentResource).apply(resource => {
    if (resource && resource.metadata) {
        return resource.metadata.name;
    }
    // Return a default value or handle the case where metadata doesn't exist
    return "UnknownDeploymentName";
});