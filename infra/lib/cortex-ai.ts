import * as cdk from 'aws-cdk-lib';
import * as constructs from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';

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

export class CortexAI extends constructs.Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly dataTable: dynamodb.Table;
  public readonly dataBucket: s3.Bucket;
  public readonly api: apigateway.RestApi;
  public readonly uploadFunction: lambda.Function;
  public readonly processFunction: lambda.Function;
  public readonly insightsFunction?: lambda.Function;
  public readonly eventBus: events.EventBus;

  constructor(scope: constructs.Construct, id: string, props: CortexAIProps = {}) {
    super(scope, id);

    const applicationName = props.applicationName || 'cortex-ai';
    const environment = props.environment || 'dev';
    const enableAIInsights = props.enableAIInsights !== false;

    // Create Cognito User Pool for tenant authentication
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: props.cognitoConfig?.userPoolName || `${applicationName}-${environment}-users`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        tenantId: new cognito.StringAttribute({ mutable: true }),
        role: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: props.cognitoConfig?.passwordPolicy || {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: props.cognitoConfig?.userPoolClientName || `${applicationName}-${environment}-client`,
      generateSecret: false,
      authFlows: {
        adminUserPassword: true,
        userPassword: true,
        userSrp: true,
      },
      // oAuth: {
      //   flows: {
      //     implicitCodeGrant: true,
      //   },
      //   scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
      //   callbackUrls: ['http://localhost:3000/callback'], // Update with your frontend URL
      // },n
    });

    // Create Identity Pool for AWS service access
    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `${applicationName}-${environment}-identity`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{
        clientId: this.userPoolClient.userPoolClientId,
        providerName: this.userPool.userPoolProviderName,
      }],
    });

    // Create DynamoDB table for tenant data with tenantId as partition key
    this.dataTable = new dynamodb.Table(this, 'DataTable', {
      tableName: `${applicationName}-${environment}-data`,
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'dataId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: props.dynamoConfig?.billingMode || dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: props.dynamoConfig?.removalPolicy || cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for querying by data type and timestamp
    this.dataTable.addGlobalSecondaryIndex({
      indexName: 'DataTypeTimestampIndex',
      partitionKey: {
        name: 'dataType',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Create S3 bucket for tenant data storage
    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `${applicationName}-${environment}-data-${cdk.Stack.of(this).account}-${cdk.Stack.of(this).region}`,
      versioned: props.s3Config?.versioned !== false,
      encryption: props.s3Config?.encryption || s3.BucketEncryption.S3_MANAGED,
      removalPolicy: props.s3Config?.removalPolicy || cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.s3Config?.removalPolicy === cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'transition-to-ia',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Create EventBridge for decoupled processing
    this.eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: `${applicationName}-${environment}-events`,
    });

    // Create Lambda function for data upload
    this.uploadFunction = new lambda.Function(this, 'UploadFunction', {
      functionName: `${applicationName}-${environment}-upload`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/upload')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        DATA_TABLE_NAME: this.dataTable.tableName,
        DATA_BUCKET_NAME: this.dataBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        ENABLE_AI_INSIGHTS: enableAIInsights.toString(),
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to upload function
    this.dataTable.grantWriteData(this.uploadFunction);
    this.dataBucket.grantWrite(this.uploadFunction);
    this.eventBus.grantPutEventsTo(this.uploadFunction);

    // Create Lambda function for data processing
    this.processFunction = new lambda.Function(this, 'ProcessFunction', {
      functionName: `${applicationName}-${environment}-process`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/process')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: {
        DATA_TABLE_NAME: this.dataTable.tableName,
        DATA_BUCKET_NAME: this.dataBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        ENABLE_AI_INSIGHTS: enableAIInsights.toString(),
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create Lambda function for listing files
    const listFilesFunction = new lambda.Function(this, 'ListFilesFunction', {
      functionName: `${applicationName}-${environment}-list-files`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/list-files')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        DATA_TABLE_NAME: this.dataTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant permissions to process function
    this.dataTable.grantReadWriteData(this.processFunction);
    this.dataBucket.grantReadWrite(this.processFunction);
    this.eventBus.grantPutEventsTo(this.processFunction);

    // Grant permissions to list files function
    this.dataTable.grantReadData(listFilesFunction);

    // Create AI Insights Lambda function if enabled
    if (enableAIInsights) {
      this.insightsFunction = new lambda.Function(this, 'InsightsFunction', {
        functionName: `${applicationName}-${environment}-insights`,
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/insights')),
        timeout: cdk.Duration.seconds(120),
        memorySize: 1024,
        environment: {
          DATA_TABLE_NAME: this.dataTable.tableName,
          DATA_BUCKET_NAME: this.dataBucket.bucketName,
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      // Grant Bedrock permissions to insights function
      this.insightsFunction.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'], // You can restrict this to specific model ARNs
      }));

      // Grant other necessary permissions
      this.dataTable.grantReadWriteData(this.insightsFunction);
      this.dataBucket.grantRead(this.insightsFunction);
    }

    // Create API Gateway
    this.api = new apigateway.RestApi(this, 'CortexAIAPI', {
      restApiName: `${applicationName}-${environment}-api`,
      description: 'CortexAI Multi-tenant API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
      },
      deployOptions: {
        stageName: environment,
        // Disable logging to avoid CloudWatch Logs role requirement
        // loggingLevel: apigateway.MethodLoggingLevel.INFO,
        // dataTraceEnabled: true,
      },
    });

    // Create Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [this.userPool],
      authorizerName: `${applicationName}-${environment}-authorizer`,
    });

    // Create API resources and methods
    const uploadResource = this.api.root.addResource('upload');
    const uploadIntegration = new apigateway.LambdaIntegration(this.uploadFunction, {
      integrationResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID'",
            'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
          },
        },
      ],
    });
    
    uploadResource.addMethod('POST', uploadIntegration, {
      authorizer: authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      requestParameters: {
        'method.request.header.X-Tenant-ID': true,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
          },
        },
      ],
    });

    // Add files listing endpoint
    const filesResource = this.api.root.addResource('files');
    const filesIntegration = new apigateway.LambdaIntegration(listFilesFunction, {
      integrationResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID'",
            'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
          },
        },
      ],
      requestTemplates: {
        'application/json': '{"tenantId": "$input.params(\'X-Tenant-ID\')", "queryParams": $input.params().querystring, "headers": $input.params().header}',
      },
    });
    
    filesResource.addMethod('GET', filesIntegration, {
      authorizer: authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      requestParameters: {
        'method.request.header.X-Tenant-ID': true,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
          },
        },
      ],
    });

    // Add insights endpoint if AI insights is enabled
    if (enableAIInsights && this.insightsFunction) {
      const insightsResource = this.api.root.addResource('insights');
      const insightsIntegration = new apigateway.LambdaIntegration(this.insightsFunction, {
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-ID'",
              'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'",
            },
          },
        ],
        requestTemplates: {
          'application/json': '{"dataId": "$input.params(\'dataId\')", "prompt": "$input.params(\'prompt\')", "queryParams": $input.params().querystring, "headers": $input.params().header}',
        },
      });
      
      insightsResource.addMethod('GET', insightsIntegration, {
        authorizer: authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.dataId': true,
          'method.request.querystring.prompt': true,
        },
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
              'method.response.header.Access-Control-Allow-Headers': true,
              'method.response.header.Access-Control-Allow-Methods': true,
            },
          },
        ],
      });
    }

    // Add health check endpoint
    const healthResource = this.api.root.addResource('health');
    healthResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: {
          'application/json': JSON.stringify({ status: 'healthy', timestamp: '$context.requestTime' }),
        },
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}',
      },
    }), {
      methodResponses: [{ statusCode: '200' }],
    });

    // Create EventBridge rule to trigger processing function
    const processRule = new events.Rule(this, 'ProcessRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['cortex-ai.upload'],
        detailType: ['DataUploaded'],
      },
      targets: [new targets.LambdaFunction(this.processFunction)],
    });

    // Create EventBridge rule to trigger AI insights if enabled
    if (enableAIInsights && this.insightsFunction) {
      const insightsRule = new events.Rule(this, 'InsightsRule', {
        eventBus: this.eventBus,
        eventPattern: {
          source: ['cortex-ai.process'],
          detailType: ['DataProcessed'],
        },
        targets: [new targets.LambdaFunction(this.insightsFunction)],
      });
    }

    // Create IAM policy for tenant access control
    const tenantAccessPolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
            's3:ListBucket',
          ],
          resources: [
            this.dataBucket.bucketArn,
            `${this.dataBucket.bucketArn}/*`,
          ],
          conditions: {
            'StringEquals': {
              'aws:PrincipalTag/tenantId': '${aws:PrincipalTag/tenantId}',
            },
            'StringLike': {
              's3:prefix': '${aws:PrincipalTag/tenantId}/*',
            },
          },
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
          ],
          resources: [
            this.dataTable.tableArn,
            `${this.dataTable.tableArn}/index/*`,
          ],
          conditions: {
            'StringEquals': {
              'dynamodb:LeadingKeys': '${aws:PrincipalTag/tenantId}',
            },
          },
        }),
      ],
    });

    // Create IAM roles for authenticated users
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        'StringEquals': {
          'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
        },
        'ForAnyValue:StringLike': {
          'cognito-identity.amazonaws.com:amr': 'authenticated',
        },
      }, 'sts:AssumeRoleWithWebIdentity'),
      description: 'Role for authenticated users in CortexAI',
    });

    // Attach the tenant access policy to the authenticated role
    authenticatedRole.attachInlinePolicy(new iam.Policy(this, 'TenantAccessPolicy', {
      document: tenantAccessPolicy,
    }));

    // Attach the authenticated role to the Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // Output important values for frontend configuration
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${applicationName}-${environment}-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${applicationName}-${environment}-user-pool-client-id`,
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: `${applicationName}-${environment}-identity-pool-id`,
    });

    new cdk.CfnOutput(this, 'DataTableName', {
      value: this.dataTable.tableName,
      description: 'DynamoDB Data Table Name',
      exportName: `${applicationName}-${environment}-data-table-name`,
    });

    new cdk.CfnOutput(this, 'DataBucketName', {
      value: this.dataBucket.bucketName,
      description: 'S3 Data Bucket Name',
      exportName: `${applicationName}-${environment}-data-bucket-name`,
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
      exportName: `${applicationName}-${environment}-api-url`,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'EventBridge Event Bus Name',
      exportName: `${applicationName}-${environment}-event-bus-name`,
    });
  }
}
