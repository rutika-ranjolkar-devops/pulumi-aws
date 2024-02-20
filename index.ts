import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import { SubnetType } from "@pulumi/awsx/ec2";
import * as eks from "@pulumi/eks";
import * as iam from "./iam";
import assert = require("assert");
import * as k8s from "@pulumi/kubernetes";

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














const cluster = new eks.Cluster("air-tek-cluster", {
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

// Create a namespace.
//const appsNamespace = new k8s.core.v1.Namespace("apps", undefined, {provider: provider});
//export const appsNamespaceName = appsNamespace.metadata.name;

const appsNamespaceName = "kube-system"
// Create the new IAM policy for the Service Account using the
// AssumeRoleWebWebIdentity action.
const saName = "air-tek-sa";
const saAssumeRolePolicy = pulumi.all([clusterOidcProviderUrl, clusterOidcProvider.arn, appsNamespaceName]).apply(([url, arn, namespace]) => aws.iam.getPolicyDocument({
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



// Create the Service Account with the IAM role annotated.
const sa = new k8s.core.v1.ServiceAccount(saName, {
    metadata: {
        namespace: appsNamespaceName,
        name: saName,
        annotations: {
            "eks.amazonaws.com/role-arn": saRole.arn,
        },
    },
}, { provider: provider});

const customPolicy = new aws.iam.Policy("customPolicy", {
    name: "CustomPolicy",
    description: "Custom IAM policy for Pulumi",
    policy:
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["iam:CreateServiceLinkedRole"],
          Resource: "*",
          Condition: {
            StringEquals: {
              "iam:AWSServiceName": "elasticloadbalancing.amazonaws.com",
            },
          },
        },
        {
          Effect: "Allow",
          Action: [
            "ec2:DescribeAccountAttributes",
            "ec2:DescribeAddresses",
            "ec2:DescribeAvailabilityZones",
            "ec2:DescribeInternetGateways",
            "ec2:DescribeVpcs",
            "ec2:DescribeVpcPeeringConnections",
            "ec2:DescribeSubnets",
            "ec2:DescribeSecurityGroups",
            "ec2:DescribeInstances",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DescribeTags",
            "ec2:GetCoipPoolUsage",
            "ec2:DescribeCoipPools",
            "elasticloadbalancing:DescribeLoadBalancers",
            "elasticloadbalancing:DescribeLoadBalancerAttributes",
            "elasticloadbalancing:DescribeListeners",
            "elasticloadbalancing:DescribeListenerCertificates",
            "elasticloadbalancing:DescribeSSLPolicies",
            "elasticloadbalancing:DescribeRules",
            "elasticloadbalancing:DescribeTargetGroups",
            "elasticloadbalancing:DescribeTargetGroupAttributes",
            "elasticloadbalancing:DescribeTargetHealth",
            "elasticloadbalancing:DescribeTags",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "cognito-idp:DescribeUserPoolClient",
            "acm:ListCertificates",
            "acm:DescribeCertificate",
            "iam:ListServerCertificates",
            "iam:GetServerCertificate",
            "waf-regional:GetWebACL",
            "waf-regional:GetWebACLForResource",
            "waf-regional:AssociateWebACL",
            "waf-regional:DisassociateWebACL",
            "wafv2:GetWebACL",
            "wafv2:GetWebACLForResource",
            "wafv2:AssociateWebACL",
            "wafv2:DisassociateWebACL",
            "shield:GetSubscriptionState",
            "shield:DescribeProtection",
            "shield:CreateProtection",
            "shield:DeleteProtection",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "ec2:AuthorizeSecurityGroupIngress",
            "ec2:RevokeSecurityGroupIngress",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: ["ec2:CreateSecurityGroup"],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: ["ec2:CreateTags"],
          Resource: "arn:aws:ec2:*:*:security-group/*",
          Condition: {
            StringEquals: {
              "ec2:CreateAction": "CreateSecurityGroup",
            },
            Null: {
              "aws:RequestTag/elbv2.k8s.aws/cluster": "false",
            },
          },
        },
        {
          Effect: "Allow",
          Action: ["ec2:CreateTags", "ec2:DeleteTags"],
          Resource: "arn:aws:ec2:*:*:security-group/*",
          Condition: {
            Null: {
              "aws:RequestTag/elbv2.k8s.aws/cluster": "true",
              "aws:ResourceTag/elbv2.k8s.aws/cluster": "false",
            },
          },
        },
        {
          Effect: "Allow",
          Action: [
            "ec2:AuthorizeSecurityGroupIngress",
            "ec2:RevokeSecurityGroupIngress",
            "ec2:DeleteSecurityGroup",
          ],
          Resource: "*",
          Condition: {
            Null: {
              "aws:ResourceTag/elbv2.k8s.aws/cluster": "false",
            },
          },
        },
        {
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:CreateLoadBalancer",
            "elasticloadbalancing:CreateTargetGroup",
          ],
          Resource: "*",
          Condition: {
            Null: {
              "aws:RequestTag/elbv2.k8s.aws/cluster": "false",
            },
          },
        },
        {
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:CreateListener",
            "elasticloadbalancing:DeleteListener",
            "elasticloadbalancing:CreateRule",
            "elasticloadbalancing:DeleteRule",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:AddTags",
            "elasticloadbalancing:RemoveTags",
          ],
          Resource: [
            "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*",
            "arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*",
            "arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*",
          ],
          Condition: {
            Null: {
              "aws:RequestTag/elbv2.k8s.aws/cluster": "true",
              "aws:ResourceTag/elbv2.k8s.aws/cluster": "false"
            },
          },
        },
        {
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:AddTags",
            "elasticloadbalancing:RemoveTags",
          ],
          Resource: [
            "arn:aws:elasticloadbalancing:*:*:listener/net/*/*/*",
            "arn:aws:elasticloadbalancing:*:*:listener/app/*/*/*",
            "arn:aws:elasticloadbalancing:*:*:listener-rule/net/*/*/*",
            "arn:aws:elasticloadbalancing:*:*:listener-rule/app/*/*/*",
          ],
        },
        {
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:ModifyLoadBalancerAttributes",
            "elasticloadbalancing:SetIpAddressType",
            "elasticloadbalancing:SetSecurityGroups",
            "elasticloadbalancing:SetSubnets",
            "elasticloadbalancing:DeleteLoadBalancer",
            "elasticloadbalancing:ModifyTargetGroup",
            "elasticloadbalancing:ModifyTargetGroupAttributes",
            "elasticloadbalancing:DeleteTargetGroup",
          ],
          Resource: "*",
          Condition: {
            Null: {
              "aws:ResourceTag/elbv2.k8s.aws/cluster": "false",
            },
          },
        },
        {
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:AddTags",
          ],
          Resource: [
            "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*",
            "arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*",
            "arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*",
          ],
          Condition: {
            StringEquals: {
              "elasticloadbalancing:CreateAction": [
                "CreateTargetGroup",
                "CreateLoadBalancer",
              ],
            },
            Null: {
              "aws:RequestTag/elbv2.k8s.aws/cluster": "false",
            },
          },
        },
        {
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:RegisterTargets",
            "elasticloadbalancing:DeregisterTargets",
          ],
          Resource: "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*",
        },
        {
          Effect: "Allow",
          Action: [
            "elasticloadbalancing:SetWebAcl",
            "elasticloadbalancing:ModifyListener",
            "elasticloadbalancing:AddListenerCertificates",
            "elasticloadbalancing:RemoveListenerCertificates",
            "elasticloadbalancing:ModifyRule",
          ],
          Resource: "*",
        },
      ],
    },
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
























//export const clusterOidcProviderUrl = clusterOidcProvider.url;
// Export the repository URL to be used in future steps such as pushing a Docker image
export const repositoryUrl = repo.repositoryUrl;
export const vpcId = vpc.vpcId;
