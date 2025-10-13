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

export class CortexAIStack extends cdk.Stack {
  public readonly cortexAI: CortexAI;

  constructor(scope: Construct, id: string, props: CortexAIStackProps = {}) {
    super(scope, id, props);

    const applicationName = props.applicationName || 'cortex-ai';
    const environment = props.environment || 'dev';

    // Create the CortexAI construct
    this.cortexAI = new CortexAI(this, 'CortexAI', {
      applicationName,
      environment,
      enableAIInsights: props.enableAIInsights,
      cognitoConfig: props.cognitoConfig,
      dynamoConfig: props.dynamoConfig ? {
        billingMode: props.dynamoConfig.billingMode === 'PROVISIONED' 
          ? cdk.aws_dynamodb.BillingMode.PROVISIONED 
          : cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: props.dynamoConfig.removalPolicy === 'RETAIN' 
          ? cdk.RemovalPolicy.RETAIN 
          : props.dynamoConfig.removalPolicy === 'SNAPSHOT' 
            ? cdk.RemovalPolicy.SNAPSHOT 
            : cdk.RemovalPolicy.DESTROY,
      } : undefined,
      s3Config: props.s3Config ? {
        removalPolicy: props.s3Config.removalPolicy === 'RETAIN' 
          ? cdk.RemovalPolicy.RETAIN 
          : props.s3Config.removalPolicy === 'SNAPSHOT' 
            ? cdk.RemovalPolicy.SNAPSHOT 
            : cdk.RemovalPolicy.DESTROY,
        versioned: props.s3Config.versioned,
      } : undefined,
    });

    // Add tags to all resources
    cdk.Tags.of(this).add('Application', applicationName);
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('Owner', 'CortexAI Team');
  }
}
