import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import { SubnetType } from "@pulumi/awsx/ec2";
import * as eks from "@pulumi/eks";
import * as iam from "./iam";

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

// Attach the AmazonEKSVPCResourceController to the role.
const eksAmazonEKSVPCResourceControllerPolicyAttachment = new aws.iam.RolePolicyAttachment("eksAmazonEKSVPCResourceControllerPolicyAttachment", {
    role: eksRole.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController", // This ARN is for the AmazonEKSVPCResourceController policy
});


const cluster = new eks.Cluster(`${projectName}`, {
    vpcId: vpc.vpcId,
    privateSubnetIds: vpc.privateSubnetIds,
    createOidcProvider: true,
    roleMappings: [{
            roleArn: eksRole.arn, // Use the role created above
            groups: ["system:masters"],
            username: "admin",
        }],
        serviceRole: eksRole,

    tags,
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
const repo = new aws.ecr.Repository("myRepository", {});

// Export the repository URL to be used in future steps such as pushing a Docker image
export const repositoryUrl = repo.repositoryUrl;


// Export the cluster kubeconfig.
export const kubeconfig = cluster.kubeconfig;
export const vpcId = vpc.vpcId;
if (!cluster?.core?.oidcProvider) {
    throw new Error("Invalid cluster OIDC provider URL");
}
export const oidcProviderUrl = cluster.core.oidcProvider.url;