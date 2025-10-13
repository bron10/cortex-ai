import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CortexAI } from './cortex-ai';
export interface CortexAIStackProps extends cdk.StackProps {
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
    };
    /**
     * DynamoDB table configuration
     */
    readonly dynamoConfig?: {
        readonly billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED';
        readonly removalPolicy?: 'DESTROY' | 'RETAIN' | 'SNAPSHOT';
    };
    /**
     * S3 bucket configuration
     */
    readonly s3Config?: {
        readonly removalPolicy?: 'DESTROY' | 'RETAIN' | 'SNAPSHOT';
        readonly versioned?: boolean;
    };
}
export declare class CortexAIStack extends cdk.Stack {
    readonly cortexAI: CortexAI;
    constructor(scope: Construct, id: string, props?: CortexAIStackProps);
}
