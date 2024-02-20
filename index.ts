import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import { SubnetType } from "@pulumi/awsx/ec2";
import * as eks from "@pulumi/eks";

const projectName = pulumi.getProject();
const tags = { "Status": "Demo", "Project": "pulumi-aws"};

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
    publicSubnetIds: vpc.publicSubnetIds,
    privateSubnetIds: vpc.privateSubnetIds,
    createOidcProvider: true,
    roleMappings: [{
            roleArn: eksRole.arn, // Use the role created above
            groups: ["system:masters"],
            username: "admin",
        }],
        serviceRole: eksRole,
        endpointPrivateAccess: true
        endpointPublicAccess: false

    tags,
});

const managedNodeGroup = eks.createManagedNodeGroup("${projectName}-ng", {
    cluster: cluster,
    nodeGroupName: "${projectName}-ng",
    scalingConfig: {
        desiredSize: 1,
        minSize: 1,
        maxSize: 2,
    },
    instanceTypes: ["t3.medium"],
    labels: {"ondemand": "true"},
    tags
}, cluster);


// Export the cluster kubeconfig.
export const kubeconfig = cluster.kubeconfig;
export const vpcId = vpc.vpcId;
if (!cluster?.core?.oidcProvider) {
    throw new Error("Invalid cluster OIDC provider URL");
}
export const oidcProviderUrl = cluster.core.oidcProvider.url;