# pulumi-aws

## About
- Project to create AWS infrastructure using Pulumi as IaC. The language of choice in Typescript.
- Code creates VPC and corresponding components, launches an EKS cluster. 
- A helm chart for AWS Load balancer controller is also created. 

## To provision the infrastructure:

- Configure AWS CLI with your access & secret keys
- Install Pulumi
- Create a stack and run `pulumi up`

## To deploy the app:
`helm install <release name> <path to Chart.yaml>`
or
`helm upgrade <release name> <path to Chart.yaml>`
