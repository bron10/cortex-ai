import * as cdk from 'aws-cdk-lib';
import * as constructs from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
export interface CortexAIProps {
    /**
     * The name of the application
     * @default 'cortex-ai'
     */
    readonly applicationName?: string;
    /**
     * Environment name (dev, staging, prod)
     * @default 'dev'
     */
    readonly environment?: string;
    /**
     * Whether to enable AI insights using Amazon Bedrock
     * @default true
     */
    readonly enableAIInsights?: boolean;
    /**
     * Cognito user pool configuration
     */
    readonly cognitoConfig?: {
        readonly userPoolName?: string;
        readonly userPoolClientName?: string;
        readonly passwordPolicy?: cognito.PasswordPolicy;
    };
    /**
     * DynamoDB table configuration
     */
    readonly dynamoConfig?: {
        readonly billingMode?: dynamodb.BillingMode;
        readonly removalPolicy?: cdk.RemovalPolicy;
    };
    /**
     * S3 bucket configuration
     */
    readonly s3Config?: {
        readonly removalPolicy?: cdk.RemovalPolicy;
        readonly versioned?: boolean;
        readonly encryption?: s3.BucketEncryption;
    };
}
export declare class CortexAI extends constructs.Construct {
    readonly userPool: cognito.UserPool;
    readonly userPoolClient: cognito.UserPoolClient;
    readonly identityPool: cognito.CfnIdentityPool;
    readonly dataTable: dynamodb.Table;
    readonly dataBucket: s3.Bucket;
    readonly api: apigateway.RestApi;
    readonly uploadFunction: lambda.Function;
    readonly processFunction: lambda.Function;
    readonly insightsFunction?: lambda.Function;
    readonly eventBus: events.EventBus;
    constructor(scope: constructs.Construct, id: string, props?: CortexAIProps);
}
