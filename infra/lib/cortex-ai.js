"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CortexAI = void 0;
const cdk = require("aws-cdk-lib");
const constructs = require("constructs");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const s3 = require("aws-cdk-lib/aws-s3");
const cognito = require("aws-cdk-lib/aws-cognito");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const lambda = require("aws-cdk-lib/aws-lambda");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
const path = require("path");
class CortexAI extends constructs.Construct {
    constructor(scope, id, props = {}) {
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
exports.CortexAI = CortexAI;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29ydGV4LWFpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29ydGV4LWFpLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyx5Q0FBeUM7QUFDekMscURBQXFEO0FBQ3JELHlDQUF5QztBQUN6QyxtREFBbUQ7QUFDbkQseURBQXlEO0FBQ3pELGlEQUFpRDtBQUNqRCwyQ0FBMkM7QUFDM0MsNkNBQTZDO0FBQzdDLGlEQUFpRDtBQUNqRCwwREFBMEQ7QUFDMUQsNkJBQTZCO0FBZ0Q3QixNQUFhLFFBQVMsU0FBUSxVQUFVLENBQUMsU0FBUztJQVloRCxZQUFZLEtBQTJCLEVBQUUsRUFBVSxFQUFFLFFBQXVCLEVBQUU7UUFDNUUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLGVBQWUsR0FBRyxLQUFLLENBQUMsZUFBZSxJQUFJLFdBQVcsQ0FBQztRQUM3RCxNQUFNLFdBQVcsR0FBRyxLQUFLLENBQUMsV0FBVyxJQUFJLEtBQUssQ0FBQztRQUMvQyxNQUFNLGdCQUFnQixHQUFHLEtBQUssQ0FBQyxnQkFBZ0IsS0FBSyxLQUFLLENBQUM7UUFFMUQscURBQXFEO1FBQ3JELElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDckQsWUFBWSxFQUFFLEtBQUssQ0FBQyxhQUFhLEVBQUUsWUFBWSxJQUFJLEdBQUcsZUFBZSxJQUFJLFdBQVcsUUFBUTtZQUM1RixpQkFBaUIsRUFBRSxJQUFJO1lBQ3ZCLGFBQWEsRUFBRTtnQkFDYixLQUFLLEVBQUUsSUFBSTthQUNaO1lBQ0Qsa0JBQWtCLEVBQUU7Z0JBQ2xCLEtBQUssRUFBRTtvQkFDTCxRQUFRLEVBQUUsSUFBSTtvQkFDZCxPQUFPLEVBQUUsSUFBSTtpQkFDZDtnQkFDRCxTQUFTLEVBQUU7b0JBQ1QsUUFBUSxFQUFFLElBQUk7b0JBQ2QsT0FBTyxFQUFFLElBQUk7aUJBQ2Q7Z0JBQ0QsVUFBVSxFQUFFO29CQUNWLFFBQVEsRUFBRSxJQUFJO29CQUNkLE9BQU8sRUFBRSxJQUFJO2lCQUNkO2FBQ0Y7WUFDRCxnQkFBZ0IsRUFBRTtnQkFDaEIsUUFBUSxFQUFFLElBQUksT0FBTyxDQUFDLGVBQWUsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQztnQkFDeEQsSUFBSSxFQUFFLElBQUksT0FBTyxDQUFDLGVBQWUsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQzthQUNyRDtZQUNELGNBQWMsRUFBRSxLQUFLLENBQUMsYUFBYSxFQUFFLGNBQWMsSUFBSTtnQkFDckQsU0FBUyxFQUFFLENBQUM7Z0JBQ1osZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsYUFBYSxFQUFFLElBQUk7Z0JBQ25CLGNBQWMsRUFBRSxJQUFJO2FBQ3JCO1lBQ0QsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVTtZQUNuRCxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILDBCQUEwQjtRQUMxQixJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksT0FBTyxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDdkUsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3ZCLGtCQUFrQixFQUFFLEtBQUssQ0FBQyxhQUFhLEVBQUUsa0JBQWtCLElBQUksR0FBRyxlQUFlLElBQUksV0FBVyxTQUFTO1lBQ3pHLGNBQWMsRUFBRSxLQUFLO1lBQ3JCLFNBQVMsRUFBRTtnQkFDVCxpQkFBaUIsRUFBRSxJQUFJO2dCQUN2QixZQUFZLEVBQUUsSUFBSTtnQkFDbEIsT0FBTyxFQUFFLElBQUk7YUFDZDtZQUNELFdBQVc7WUFDWCxhQUFhO1lBQ2IsK0JBQStCO1lBQy9CLE9BQU87WUFDUCwrRkFBK0Y7WUFDL0YsdUZBQXVGO1lBQ3ZGLE1BQU07U0FDUCxDQUFDLENBQUM7UUFFSCw4Q0FBOEM7UUFDOUMsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLE9BQU8sQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUNwRSxnQkFBZ0IsRUFBRSxHQUFHLGVBQWUsSUFBSSxXQUFXLFdBQVc7WUFDOUQsOEJBQThCLEVBQUUsS0FBSztZQUNyQyx3QkFBd0IsRUFBRSxDQUFDO29CQUN6QixRQUFRLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0I7b0JBQzlDLFlBQVksRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLG9CQUFvQjtpQkFDakQsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILHVFQUF1RTtRQUN2RSxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO1lBQ3JELFNBQVMsRUFBRSxHQUFHLGVBQWUsSUFBSSxXQUFXLE9BQU87WUFDbkQsWUFBWSxFQUFFO2dCQUNaLElBQUksRUFBRSxVQUFVO2dCQUNoQixJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1lBQ0QsT0FBTyxFQUFFO2dCQUNQLElBQUksRUFBRSxRQUFRO2dCQUNkLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7WUFDRCxXQUFXLEVBQUUsS0FBSyxDQUFDLFlBQVksRUFBRSxXQUFXLElBQUksUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ3BGLGFBQWEsRUFBRSxLQUFLLENBQUMsWUFBWSxFQUFFLGFBQWEsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87WUFDN0UsbUJBQW1CLEVBQUUsSUFBSTtZQUN6QixtQkFBbUIsRUFBRSxLQUFLO1NBQzNCLENBQUMsQ0FBQztRQUVILGtEQUFrRDtRQUNsRCxJQUFJLENBQUMsU0FBUyxDQUFDLHVCQUF1QixDQUFDO1lBQ3JDLFNBQVMsRUFBRSx3QkFBd0I7WUFDbkMsWUFBWSxFQUFFO2dCQUNaLElBQUksRUFBRSxVQUFVO2dCQUNoQixJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1lBQ0QsT0FBTyxFQUFFO2dCQUNQLElBQUksRUFBRSxXQUFXO2dCQUNqQixJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNO2FBQ3BDO1lBQ0QsY0FBYyxFQUFFLFFBQVEsQ0FBQyxjQUFjLENBQUMsR0FBRztTQUM1QyxDQUFDLENBQUM7UUFFSCwyQ0FBMkM7UUFDM0MsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNsRCxVQUFVLEVBQUUsR0FBRyxlQUFlLElBQUksV0FBVyxTQUFTLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLEVBQUU7WUFDL0csU0FBUyxFQUFFLEtBQUssQ0FBQyxRQUFRLEVBQUUsU0FBUyxLQUFLLEtBQUs7WUFDOUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxRQUFRLEVBQUUsVUFBVSxJQUFJLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVO1lBQ3hFLGFBQWEsRUFBRSxLQUFLLENBQUMsUUFBUSxFQUFFLGFBQWEsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87WUFDekUsaUJBQWlCLEVBQUUsS0FBSyxDQUFDLFFBQVEsRUFBRSxhQUFhLEtBQUssR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQzlFLGlCQUFpQixFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTO1lBQ2pELFVBQVUsRUFBRSxJQUFJO1lBQ2hCLGNBQWMsRUFBRTtnQkFDZDtvQkFDRSxFQUFFLEVBQUUsa0JBQWtCO29CQUN0QixPQUFPLEVBQUUsSUFBSTtvQkFDYixXQUFXLEVBQUU7d0JBQ1g7NEJBQ0UsWUFBWSxFQUFFLEVBQUUsQ0FBQyxZQUFZLENBQUMsaUJBQWlCOzRCQUMvQyxlQUFlLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO3lCQUN2Qzt3QkFDRDs0QkFDRSxZQUFZLEVBQUUsRUFBRSxDQUFDLFlBQVksQ0FBQyxPQUFPOzRCQUNyQyxlQUFlLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO3lCQUN2QztxQkFDRjtpQkFDRjthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsOENBQThDO1FBQzlDLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDcEQsWUFBWSxFQUFFLEdBQUcsZUFBZSxJQUFJLFdBQVcsU0FBUztTQUN6RCxDQUFDLENBQUM7UUFFSCx5Q0FBeUM7UUFDekMsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ2hFLFlBQVksRUFBRSxHQUFHLGVBQWUsSUFBSSxXQUFXLFNBQVM7WUFDeEQsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsZUFBZTtZQUN4QixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsa0JBQWtCLENBQUMsQ0FBQztZQUNyRSxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2pDLFVBQVUsRUFBRSxHQUFHO1lBQ2YsV0FBVyxFQUFFO2dCQUNYLGVBQWUsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVM7Z0JBQ3pDLGdCQUFnQixFQUFFLElBQUksQ0FBQyxVQUFVLENBQUMsVUFBVTtnQkFDNUMsY0FBYyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWTtnQkFDMUMsa0JBQWtCLEVBQUUsZ0JBQWdCLENBQUMsUUFBUSxFQUFFO2FBQ2hEO1lBQ0QsWUFBWSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtTQUMxQyxDQUFDLENBQUM7UUFFSCx1Q0FBdUM7UUFDdkMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQ25ELElBQUksQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNoRCxJQUFJLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUVwRCw2Q0FBNkM7UUFDN0MsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ2xFLFlBQVksRUFBRSxHQUFHLGVBQWUsSUFBSSxXQUFXLFVBQVU7WUFDekQsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVztZQUNuQyxPQUFPLEVBQUUsZUFBZTtZQUN4QixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztZQUN0RSxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ2pDLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLFdBQVcsRUFBRTtnQkFDWCxlQUFlLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTO2dCQUN6QyxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLFVBQVU7Z0JBQzVDLGNBQWMsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVk7Z0JBQzFDLGtCQUFrQixFQUFFLGdCQUFnQixDQUFDLFFBQVEsRUFBRTthQUNoRDtZQUNELFlBQVksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVE7U0FDMUMsQ0FBQyxDQUFDO1FBRUgsMkNBQTJDO1FBQzNDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUN2RSxZQUFZLEVBQUUsR0FBRyxlQUFlLElBQUksV0FBVyxhQUFhO1lBQzVELE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsT0FBTyxFQUFFLGVBQWU7WUFDeEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLHNCQUFzQixDQUFDLENBQUM7WUFDekUsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNqQyxVQUFVLEVBQUUsR0FBRztZQUNmLFdBQVcsRUFBRTtnQkFDWCxlQUFlLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTO2FBQzFDO1lBQ0QsWUFBWSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtTQUMxQyxDQUFDLENBQUM7UUFFSCx3Q0FBd0M7UUFDeEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUM7UUFDeEQsSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBQ3JELElBQUksQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBRXJELDJDQUEyQztRQUMzQyxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBRWhELGdEQUFnRDtRQUNoRCxJQUFJLGdCQUFnQixFQUFFO1lBQ3BCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO2dCQUNwRSxZQUFZLEVBQUUsR0FBRyxlQUFlLElBQUksV0FBVyxXQUFXO2dCQUMxRCxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO2dCQUNuQyxPQUFPLEVBQUUsZUFBZTtnQkFDeEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLG9CQUFvQixDQUFDLENBQUM7Z0JBQ3ZFLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUM7Z0JBQ2xDLFVBQVUsRUFBRSxJQUFJO2dCQUNoQixXQUFXLEVBQUU7b0JBQ1gsZUFBZSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUztvQkFDekMsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxVQUFVO2lCQUM3QztnQkFDRCxZQUFZLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRO2FBQzFDLENBQUMsQ0FBQztZQUVILGlEQUFpRDtZQUNqRCxJQUFJLENBQUMsZ0JBQWdCLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztnQkFDNUQsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztnQkFDeEIsT0FBTyxFQUFFO29CQUNQLHFCQUFxQjtvQkFDckIsdUNBQXVDO2lCQUN4QztnQkFDRCxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSwrQ0FBK0M7YUFDbEUsQ0FBQyxDQUFDLENBQUM7WUFFSixvQ0FBb0M7WUFDcEMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztZQUN6RCxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztTQUNsRDtRQUVELHFCQUFxQjtRQUNyQixJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksVUFBVSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3JELFdBQVcsRUFBRSxHQUFHLGVBQWUsSUFBSSxXQUFXLE1BQU07WUFDcEQsV0FBVyxFQUFFLDJCQUEyQjtZQUN4QywyQkFBMkIsRUFBRTtnQkFDM0IsWUFBWSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsV0FBVztnQkFDekMsWUFBWSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsV0FBVztnQkFDekMsWUFBWSxFQUFFLENBQUMsY0FBYyxFQUFFLGVBQWUsRUFBRSxhQUFhLENBQUM7YUFDL0Q7WUFDRCxhQUFhLEVBQUU7Z0JBQ2IsU0FBUyxFQUFFLFdBQVc7Z0JBQ3RCLDREQUE0RDtnQkFDNUQsb0RBQW9EO2dCQUNwRCwwQkFBMEI7YUFDM0I7U0FDRixDQUFDLENBQUM7UUFFSCw0QkFBNEI7UUFDNUIsTUFBTSxVQUFVLEdBQUcsSUFBSSxVQUFVLENBQUMsMEJBQTBCLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQ3RGLGdCQUFnQixFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQztZQUNqQyxjQUFjLEVBQUUsR0FBRyxlQUFlLElBQUksV0FBVyxhQUFhO1NBQy9ELENBQUMsQ0FBQztRQUVILG1DQUFtQztRQUNuQyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDM0QsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFO1lBQzlFLG9CQUFvQixFQUFFO2dCQUNwQjtvQkFDRSxVQUFVLEVBQUUsS0FBSztvQkFDakIsa0JBQWtCLEVBQUU7d0JBQ2xCLG9EQUFvRCxFQUFFLEtBQUs7d0JBQzNELHFEQUFxRCxFQUFFLG9GQUFvRjt3QkFDM0kscURBQXFELEVBQUUsZ0JBQWdCO3FCQUN4RTtpQkFDRjthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsY0FBYyxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsaUJBQWlCLEVBQUU7WUFDbEQsVUFBVSxFQUFFLFVBQVU7WUFDdEIsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLGlCQUFpQixDQUFDLE9BQU87WUFDdkQsaUJBQWlCLEVBQUU7Z0JBQ2pCLG1DQUFtQyxFQUFFLElBQUk7YUFDMUM7WUFDRCxlQUFlLEVBQUU7Z0JBQ2Y7b0JBQ0UsVUFBVSxFQUFFLEtBQUs7b0JBQ2pCLGtCQUFrQixFQUFFO3dCQUNsQixvREFBb0QsRUFBRSxJQUFJO3dCQUMxRCxxREFBcUQsRUFBRSxJQUFJO3dCQUMzRCxxREFBcUQsRUFBRSxJQUFJO3FCQUM1RDtpQkFDRjthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsNkJBQTZCO1FBQzdCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN6RCxNQUFNLGdCQUFnQixHQUFHLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLGlCQUFpQixFQUFFO1lBQzNFLG9CQUFvQixFQUFFO2dCQUNwQjtvQkFDRSxVQUFVLEVBQUUsS0FBSztvQkFDakIsa0JBQWtCLEVBQUU7d0JBQ2xCLG9EQUFvRCxFQUFFLEtBQUs7d0JBQzNELHFEQUFxRCxFQUFFLG9GQUFvRjt3QkFDM0kscURBQXFELEVBQUUsZUFBZTtxQkFDdkU7aUJBQ0Y7YUFDRjtZQUNELGdCQUFnQixFQUFFO2dCQUNoQixrQkFBa0IsRUFBRSwrSEFBK0g7YUFDcEo7U0FDRixDQUFDLENBQUM7UUFFSCxhQUFhLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxnQkFBZ0IsRUFBRTtZQUMvQyxVQUFVLEVBQUUsVUFBVTtZQUN0QixpQkFBaUIsRUFBRSxVQUFVLENBQUMsaUJBQWlCLENBQUMsT0FBTztZQUN2RCxpQkFBaUIsRUFBRTtnQkFDakIsbUNBQW1DLEVBQUUsSUFBSTthQUMxQztZQUNELGVBQWUsRUFBRTtnQkFDZjtvQkFDRSxVQUFVLEVBQUUsS0FBSztvQkFDakIsa0JBQWtCLEVBQUU7d0JBQ2xCLG9EQUFvRCxFQUFFLElBQUk7d0JBQzFELHFEQUFxRCxFQUFFLElBQUk7d0JBQzNELHFEQUFxRCxFQUFFLElBQUk7cUJBQzVEO2lCQUNGO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxrREFBa0Q7UUFDbEQsSUFBSSxnQkFBZ0IsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7WUFDN0MsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDL0QsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ2xGLG9CQUFvQixFQUFFO29CQUNwQjt3QkFDRSxVQUFVLEVBQUUsS0FBSzt3QkFDakIsa0JBQWtCLEVBQUU7NEJBQ2xCLG9EQUFvRCxFQUFFLEtBQUs7NEJBQzNELHFEQUFxRCxFQUFFLG9GQUFvRjs0QkFDM0kscURBQXFELEVBQUUsZUFBZTt5QkFDdkU7cUJBQ0Y7aUJBQ0Y7Z0JBQ0QsZ0JBQWdCLEVBQUU7b0JBQ2hCLGtCQUFrQixFQUFFLCtKQUErSjtpQkFDcEw7YUFDRixDQUFDLENBQUM7WUFFSCxnQkFBZ0IsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLG1CQUFtQixFQUFFO2dCQUNyRCxVQUFVLEVBQUUsVUFBVTtnQkFDdEIsaUJBQWlCLEVBQUUsVUFBVSxDQUFDLGlCQUFpQixDQUFDLE9BQU87Z0JBQ3ZELGlCQUFpQixFQUFFO29CQUNqQixtQ0FBbUMsRUFBRSxJQUFJO29CQUN6QyxtQ0FBbUMsRUFBRSxJQUFJO2lCQUMxQztnQkFDRCxlQUFlLEVBQUU7b0JBQ2Y7d0JBQ0UsVUFBVSxFQUFFLEtBQUs7d0JBQ2pCLGtCQUFrQixFQUFFOzRCQUNsQixvREFBb0QsRUFBRSxJQUFJOzRCQUMxRCxxREFBcUQsRUFBRSxJQUFJOzRCQUMzRCxxREFBcUQsRUFBRSxJQUFJO3lCQUM1RDtxQkFDRjtpQkFDRjthQUNGLENBQUMsQ0FBQztTQUNKO1FBRUQsNEJBQTRCO1FBQzVCLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUMzRCxjQUFjLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLFVBQVUsQ0FBQyxlQUFlLENBQUM7WUFDN0Qsb0JBQW9CLEVBQUUsQ0FBQztvQkFDckIsVUFBVSxFQUFFLEtBQUs7b0JBQ2pCLGlCQUFpQixFQUFFO3dCQUNqQixrQkFBa0IsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsc0JBQXNCLEVBQUUsQ0FBQztxQkFDN0Y7aUJBQ0YsQ0FBQztZQUNGLGdCQUFnQixFQUFFO2dCQUNoQixrQkFBa0IsRUFBRSxxQkFBcUI7YUFDMUM7U0FDRixDQUFDLEVBQUU7WUFDRixlQUFlLEVBQUUsQ0FBQyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsQ0FBQztTQUN6QyxDQUFDLENBQUM7UUFFSCx5REFBeUQ7UUFDekQsTUFBTSxXQUFXLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDdkQsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3ZCLFlBQVksRUFBRTtnQkFDWixNQUFNLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQztnQkFDNUIsVUFBVSxFQUFFLENBQUMsY0FBYyxDQUFDO2FBQzdCO1lBQ0QsT0FBTyxFQUFFLENBQUMsSUFBSSxPQUFPLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztTQUM1RCxDQUFDLENBQUM7UUFFSCw0REFBNEQ7UUFDNUQsSUFBSSxnQkFBZ0IsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEVBQUU7WUFDN0MsTUFBTSxZQUFZLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7Z0JBQ3pELFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtnQkFDdkIsWUFBWSxFQUFFO29CQUNaLE1BQU0sRUFBRSxDQUFDLG1CQUFtQixDQUFDO29CQUM3QixVQUFVLEVBQUUsQ0FBQyxlQUFlLENBQUM7aUJBQzlCO2dCQUNELE9BQU8sRUFBRSxDQUFDLElBQUksT0FBTyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQzthQUM3RCxDQUFDLENBQUM7U0FDSjtRQUVELDhDQUE4QztRQUM5QyxNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxDQUFDLGNBQWMsQ0FBQztZQUNoRCxVQUFVLEVBQUU7Z0JBQ1YsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO29CQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO29CQUN4QixPQUFPLEVBQUU7d0JBQ1AsY0FBYzt3QkFDZCxjQUFjO3dCQUNkLGlCQUFpQjt3QkFDakIsZUFBZTtxQkFDaEI7b0JBQ0QsU0FBUyxFQUFFO3dCQUNULElBQUksQ0FBQyxVQUFVLENBQUMsU0FBUzt3QkFDekIsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLFNBQVMsSUFBSTtxQkFDakM7b0JBQ0QsVUFBVSxFQUFFO3dCQUNWLGNBQWMsRUFBRTs0QkFDZCwyQkFBMkIsRUFBRSw4QkFBOEI7eUJBQzVEO3dCQUNELFlBQVksRUFBRTs0QkFDWixXQUFXLEVBQUUsZ0NBQWdDO3lCQUM5QztxQkFDRjtpQkFDRixDQUFDO2dCQUNGLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztvQkFDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztvQkFDeEIsT0FBTyxFQUFFO3dCQUNQLGtCQUFrQjt3QkFDbEIsa0JBQWtCO3dCQUNsQixxQkFBcUI7d0JBQ3JCLHFCQUFxQjt3QkFDckIsZ0JBQWdCO3dCQUNoQixlQUFlO3FCQUNoQjtvQkFDRCxTQUFTLEVBQUU7d0JBQ1QsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRO3dCQUN2QixHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxVQUFVO3FCQUNyQztvQkFDRCxVQUFVLEVBQUU7d0JBQ1YsY0FBYyxFQUFFOzRCQUNkLHNCQUFzQixFQUFFLDhCQUE4Qjt5QkFDdkQ7cUJBQ0Y7aUJBQ0YsQ0FBQzthQUNIO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsMkNBQTJDO1FBQzNDLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUNoRSxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsa0JBQWtCLENBQUMsZ0NBQWdDLEVBQUU7Z0JBQ3RFLGNBQWMsRUFBRTtvQkFDZCxvQ0FBb0MsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUc7aUJBQzVEO2dCQUNELHdCQUF3QixFQUFFO29CQUN4QixvQ0FBb0MsRUFBRSxlQUFlO2lCQUN0RDthQUNGLEVBQUUsK0JBQStCLENBQUM7WUFDbkMsV0FBVyxFQUFFLDBDQUEwQztTQUN4RCxDQUFDLENBQUM7UUFFSCw0REFBNEQ7UUFDNUQsaUJBQWlCLENBQUMsa0JBQWtCLENBQUMsSUFBSSxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUM5RSxRQUFRLEVBQUUsa0JBQWtCO1NBQzdCLENBQUMsQ0FBQyxDQUFDO1FBRUoscURBQXFEO1FBQ3JELElBQUksT0FBTyxDQUFDLDZCQUE2QixDQUFDLElBQUksRUFBRSw0QkFBNEIsRUFBRTtZQUM1RSxjQUFjLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxHQUFHO1lBQ3JDLEtBQUssRUFBRTtnQkFDTCxhQUFhLEVBQUUsaUJBQWlCLENBQUMsT0FBTzthQUN6QztTQUNGLENBQUMsQ0FBQztRQUVILHFEQUFxRDtRQUNyRCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNwQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVO1lBQy9CLFdBQVcsRUFBRSxzQkFBc0I7WUFDbkMsVUFBVSxFQUFFLEdBQUcsZUFBZSxJQUFJLFdBQVcsZUFBZTtTQUM3RCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLGdCQUFnQjtZQUMzQyxXQUFXLEVBQUUsNkJBQTZCO1lBQzFDLFVBQVUsRUFBRSxHQUFHLGVBQWUsSUFBSSxXQUFXLHNCQUFzQjtTQUNwRSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLEdBQUc7WUFDNUIsV0FBVyxFQUFFLDBCQUEwQjtZQUN2QyxVQUFVLEVBQUUsR0FBRyxlQUFlLElBQUksV0FBVyxtQkFBbUI7U0FDakUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsU0FBUztZQUMvQixXQUFXLEVBQUUsMEJBQTBCO1lBQ3ZDLFVBQVUsRUFBRSxHQUFHLGVBQWUsSUFBSSxXQUFXLGtCQUFrQjtTQUNoRSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLFVBQVU7WUFDakMsV0FBVyxFQUFFLHFCQUFxQjtZQUNsQyxVQUFVLEVBQUUsR0FBRyxlQUFlLElBQUksV0FBVyxtQkFBbUI7U0FDakUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRztZQUNuQixXQUFXLEVBQUUsaUJBQWlCO1lBQzlCLFVBQVUsRUFBRSxHQUFHLGVBQWUsSUFBSSxXQUFXLFVBQVU7U0FDeEQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWTtZQUNqQyxXQUFXLEVBQUUsNEJBQTRCO1lBQ3pDLFVBQVUsRUFBRSxHQUFHLGVBQWUsSUFBSSxXQUFXLGlCQUFpQjtTQUMvRCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE1Z0JELDRCQTRnQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgY29uc3RydWN0cyBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBDb3J0ZXhBSVByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBuYW1lIG9mIHRoZSBhcHBsaWNhdGlvblxuICAgKiBAZGVmYXVsdCAnY29ydGV4LWFpJ1xuICAgKi9cbiAgcmVhZG9ubHkgYXBwbGljYXRpb25OYW1lPzogc3RyaW5nO1xuICBcbiAgLyoqXG4gICAqIEVudmlyb25tZW50IG5hbWUgKGRldiwgc3RhZ2luZywgcHJvZClcbiAgICogQGRlZmF1bHQgJ2RldidcbiAgICovXG4gIHJlYWRvbmx5IGVudmlyb25tZW50Pzogc3RyaW5nO1xuICBcbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gZW5hYmxlIEFJIGluc2lnaHRzIHVzaW5nIEFtYXpvbiBCZWRyb2NrXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IGVuYWJsZUFJSW5zaWdodHM/OiBib29sZWFuO1xuICBcbiAgLyoqXG4gICAqIENvZ25pdG8gdXNlciBwb29sIGNvbmZpZ3VyYXRpb25cbiAgICovXG4gIHJlYWRvbmx5IGNvZ25pdG9Db25maWc/OiB7XG4gICAgcmVhZG9ubHkgdXNlclBvb2xOYW1lPzogc3RyaW5nO1xuICAgIHJlYWRvbmx5IHVzZXJQb29sQ2xpZW50TmFtZT86IHN0cmluZztcbiAgICByZWFkb25seSBwYXNzd29yZFBvbGljeT86IGNvZ25pdG8uUGFzc3dvcmRQb2xpY3k7XG4gIH07XG4gIFxuICAvKipcbiAgICogRHluYW1vREIgdGFibGUgY29uZmlndXJhdGlvblxuICAgKi9cbiAgcmVhZG9ubHkgZHluYW1vQ29uZmlnPzoge1xuICAgIHJlYWRvbmx5IGJpbGxpbmdNb2RlPzogZHluYW1vZGIuQmlsbGluZ01vZGU7XG4gICAgcmVhZG9ubHkgcmVtb3ZhbFBvbGljeT86IGNkay5SZW1vdmFsUG9saWN5O1xuICB9O1xuICBcbiAgLyoqXG4gICAqIFMzIGJ1Y2tldCBjb25maWd1cmF0aW9uXG4gICAqL1xuICByZWFkb25seSBzM0NvbmZpZz86IHtcbiAgICByZWFkb25seSByZW1vdmFsUG9saWN5PzogY2RrLlJlbW92YWxQb2xpY3k7XG4gICAgcmVhZG9ubHkgdmVyc2lvbmVkPzogYm9vbGVhbjtcbiAgICByZWFkb25seSBlbmNyeXB0aW9uPzogczMuQnVja2V0RW5jcnlwdGlvbjtcbiAgfTtcbn1cblxuZXhwb3J0IGNsYXNzIENvcnRleEFJIGV4dGVuZHMgY29uc3RydWN0cy5Db25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgdXNlclBvb2w6IGNvZ25pdG8uVXNlclBvb2w7XG4gIHB1YmxpYyByZWFkb25seSB1c2VyUG9vbENsaWVudDogY29nbml0by5Vc2VyUG9vbENsaWVudDtcbiAgcHVibGljIHJlYWRvbmx5IGlkZW50aXR5UG9vbDogY29nbml0by5DZm5JZGVudGl0eVBvb2w7XG4gIHB1YmxpYyByZWFkb25seSBkYXRhVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgZGF0YUJ1Y2tldDogczMuQnVja2V0O1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpOiBhcGlnYXRld2F5LlJlc3RBcGk7XG4gIHB1YmxpYyByZWFkb25seSB1cGxvYWRGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgcHJvY2Vzc0Z1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBpbnNpZ2h0c0Z1bmN0aW9uPzogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgZXZlbnRCdXM6IGV2ZW50cy5FdmVudEJ1cztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogY29uc3RydWN0cy5Db25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDb3J0ZXhBSVByb3BzID0ge30pIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3QgYXBwbGljYXRpb25OYW1lID0gcHJvcHMuYXBwbGljYXRpb25OYW1lIHx8ICdjb3J0ZXgtYWknO1xuICAgIGNvbnN0IGVudmlyb25tZW50ID0gcHJvcHMuZW52aXJvbm1lbnQgfHwgJ2Rldic7XG4gICAgY29uc3QgZW5hYmxlQUlJbnNpZ2h0cyA9IHByb3BzLmVuYWJsZUFJSW5zaWdodHMgIT09IGZhbHNlO1xuXG4gICAgLy8gQ3JlYXRlIENvZ25pdG8gVXNlciBQb29sIGZvciB0ZW5hbnQgYXV0aGVudGljYXRpb25cbiAgICB0aGlzLnVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgJ1VzZXJQb29sJywge1xuICAgICAgdXNlclBvb2xOYW1lOiBwcm9wcy5jb2duaXRvQ29uZmlnPy51c2VyUG9vbE5hbWUgfHwgYCR7YXBwbGljYXRpb25OYW1lfS0ke2Vudmlyb25tZW50fS11c2Vyc2AsXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICB9LFxuICAgICAgc3RhbmRhcmRBdHRyaWJ1dGVzOiB7XG4gICAgICAgIGVtYWlsOiB7XG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgZ2l2ZW5OYW1lOiB7XG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgZmFtaWx5TmFtZToge1xuICAgICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICAgIG11dGFibGU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgY3VzdG9tQXR0cmlidXRlczoge1xuICAgICAgICB0ZW5hbnRJZDogbmV3IGNvZ25pdG8uU3RyaW5nQXR0cmlidXRlKHsgbXV0YWJsZTogdHJ1ZSB9KSxcbiAgICAgICAgcm9sZTogbmV3IGNvZ25pdG8uU3RyaW5nQXR0cmlidXRlKHsgbXV0YWJsZTogdHJ1ZSB9KSxcbiAgICAgIH0sXG4gICAgICBwYXNzd29yZFBvbGljeTogcHJvcHMuY29nbml0b0NvbmZpZz8ucGFzc3dvcmRQb2xpY3kgfHwge1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IHRydWUsXG4gICAgICAgIHJlcXVpcmVTeW1ib2xzOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGFjY291bnRSZWNvdmVyeTogY29nbml0by5BY2NvdW50UmVjb3ZlcnkuRU1BSUxfT05MWSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgVXNlciBQb29sIENsaWVudFxuICAgIHRoaXMudXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnVXNlclBvb2xDbGllbnQnLCB7XG4gICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogcHJvcHMuY29nbml0b0NvbmZpZz8udXNlclBvb2xDbGllbnROYW1lIHx8IGAke2FwcGxpY2F0aW9uTmFtZX0tJHtlbnZpcm9ubWVudH0tY2xpZW50YCxcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICBhZG1pblVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgICAgdXNlclBhc3N3b3JkOiB0cnVlLFxuICAgICAgICB1c2VyU3JwOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIC8vIG9BdXRoOiB7XG4gICAgICAvLyAgIGZsb3dzOiB7XG4gICAgICAvLyAgICAgaW1wbGljaXRDb2RlR3JhbnQ6IHRydWUsXG4gICAgICAvLyAgIH0sXG4gICAgICAvLyAgIHNjb3BlczogW2NvZ25pdG8uT0F1dGhTY29wZS5PUEVOSUQsIGNvZ25pdG8uT0F1dGhTY29wZS5FTUFJTCwgY29nbml0by5PQXV0aFNjb3BlLlBST0ZJTEVdLFxuICAgICAgLy8gICBjYWxsYmFja1VybHM6IFsnaHR0cDovL2xvY2FsaG9zdDozMDAwL2NhbGxiYWNrJ10sIC8vIFVwZGF0ZSB3aXRoIHlvdXIgZnJvbnRlbmQgVVJMXG4gICAgICAvLyB9LG5cbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBJZGVudGl0eSBQb29sIGZvciBBV1Mgc2VydmljZSBhY2Nlc3NcbiAgICB0aGlzLmlkZW50aXR5UG9vbCA9IG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbCh0aGlzLCAnSWRlbnRpdHlQb29sJywge1xuICAgICAgaWRlbnRpdHlQb29sTmFtZTogYCR7YXBwbGljYXRpb25OYW1lfS0ke2Vudmlyb25tZW50fS1pZGVudGl0eWAsXG4gICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IGZhbHNlLFxuICAgICAgY29nbml0b0lkZW50aXR5UHJvdmlkZXJzOiBbe1xuICAgICAgICBjbGllbnRJZDogdGhpcy51c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICBwcm92aWRlck5hbWU6IHRoaXMudXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUsXG4gICAgICB9XSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBEeW5hbW9EQiB0YWJsZSBmb3IgdGVuYW50IGRhdGEgd2l0aCB0ZW5hbnRJZCBhcyBwYXJ0aXRpb24ga2V5XG4gICAgdGhpcy5kYXRhVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0RhdGFUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogYCR7YXBwbGljYXRpb25OYW1lfS0ke2Vudmlyb25tZW50fS1kYXRhYCxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAndGVuYW50SWQnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBzb3J0S2V5OiB7XG4gICAgICAgIG5hbWU6ICdkYXRhSWQnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogcHJvcHMuZHluYW1vQ29uZmlnPy5iaWxsaW5nTW9kZSB8fCBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBwcm9wcy5keW5hbW9Db25maWc/LnJlbW92YWxQb2xpY3kgfHwgY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBHU0kgZm9yIHF1ZXJ5aW5nIGJ5IGRhdGEgdHlwZSBhbmQgdGltZXN0YW1wXG4gICAgdGhpcy5kYXRhVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnRGF0YVR5cGVUaW1lc3RhbXBJbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ2RhdGFUeXBlJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiAndGltZXN0YW1wJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBTMyBidWNrZXQgZm9yIHRlbmFudCBkYXRhIHN0b3JhZ2VcbiAgICB0aGlzLmRhdGFCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdEYXRhQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYCR7YXBwbGljYXRpb25OYW1lfS0ke2Vudmlyb25tZW50fS1kYXRhLSR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9LSR7Y2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbn1gLFxuICAgICAgdmVyc2lvbmVkOiBwcm9wcy5zM0NvbmZpZz8udmVyc2lvbmVkICE9PSBmYWxzZSxcbiAgICAgIGVuY3J5cHRpb246IHByb3BzLnMzQ29uZmlnPy5lbmNyeXB0aW9uIHx8IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IHByb3BzLnMzQ29uZmlnPy5yZW1vdmFsUG9saWN5IHx8IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogcHJvcHMuczNDb25maWc/LnJlbW92YWxQb2xpY3kgPT09IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ3RyYW5zaXRpb24tdG8taWEnLFxuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgdHJhbnNpdGlvbnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuSU5GUkVRVUVOVF9BQ0NFU1MsXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoMzApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuR0xBQ0lFUixcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIEV2ZW50QnJpZGdlIGZvciBkZWNvdXBsZWQgcHJvY2Vzc2luZ1xuICAgIHRoaXMuZXZlbnRCdXMgPSBuZXcgZXZlbnRzLkV2ZW50QnVzKHRoaXMsICdFdmVudEJ1cycsIHtcbiAgICAgIGV2ZW50QnVzTmFtZTogYCR7YXBwbGljYXRpb25OYW1lfS0ke2Vudmlyb25tZW50fS1ldmVudHNgLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbiBmb3IgZGF0YSB1cGxvYWRcbiAgICB0aGlzLnVwbG9hZEZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVXBsb2FkRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGAke2FwcGxpY2F0aW9uTmFtZX0tJHtlbnZpcm9ubWVudH0tdXBsb2FkYCxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGEvdXBsb2FkJykpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgREFUQV9UQUJMRV9OQU1FOiB0aGlzLmRhdGFUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIERBVEFfQlVDS0VUX05BTUU6IHRoaXMuZGF0YUJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogdGhpcy5ldmVudEJ1cy5ldmVudEJ1c05hbWUsXG4gICAgICAgIEVOQUJMRV9BSV9JTlNJR0hUUzogZW5hYmxlQUlJbnNpZ2h0cy50b1N0cmluZygpLFxuICAgICAgfSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgdG8gdXBsb2FkIGZ1bmN0aW9uXG4gICAgdGhpcy5kYXRhVGFibGUuZ3JhbnRXcml0ZURhdGEodGhpcy51cGxvYWRGdW5jdGlvbik7XG4gICAgdGhpcy5kYXRhQnVja2V0LmdyYW50V3JpdGUodGhpcy51cGxvYWRGdW5jdGlvbik7XG4gICAgdGhpcy5ldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHRoaXMudXBsb2FkRnVuY3Rpb24pO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbiBmb3IgZGF0YSBwcm9jZXNzaW5nXG4gICAgdGhpcy5wcm9jZXNzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdQcm9jZXNzRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGAke2FwcGxpY2F0aW9uTmFtZX0tJHtlbnZpcm9ubWVudH0tcHJvY2Vzc2AsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhL3Byb2Nlc3MnKSksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgREFUQV9UQUJMRV9OQU1FOiB0aGlzLmRhdGFUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIERBVEFfQlVDS0VUX05BTUU6IHRoaXMuZGF0YUJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBFVkVOVF9CVVNfTkFNRTogdGhpcy5ldmVudEJ1cy5ldmVudEJ1c05hbWUsXG4gICAgICAgIEVOQUJMRV9BSV9JTlNJR0hUUzogZW5hYmxlQUlJbnNpZ2h0cy50b1N0cmluZygpLFxuICAgICAgfSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbiBmb3IgbGlzdGluZyBmaWxlc1xuICAgIGNvbnN0IGxpc3RGaWxlc0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTGlzdEZpbGVzRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGAke2FwcGxpY2F0aW9uTmFtZX0tJHtlbnZpcm9ubWVudH0tbGlzdC1maWxlc2AsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhL2xpc3QtZmlsZXMnKSksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBEQVRBX1RBQkxFX05BTUU6IHRoaXMuZGF0YVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIH0sXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIHByb2Nlc3MgZnVuY3Rpb25cbiAgICB0aGlzLmRhdGFUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodGhpcy5wcm9jZXNzRnVuY3Rpb24pO1xuICAgIHRoaXMuZGF0YUJ1Y2tldC5ncmFudFJlYWRXcml0ZSh0aGlzLnByb2Nlc3NGdW5jdGlvbik7XG4gICAgdGhpcy5ldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHRoaXMucHJvY2Vzc0Z1bmN0aW9uKTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIGxpc3QgZmlsZXMgZnVuY3Rpb25cbiAgICB0aGlzLmRhdGFUYWJsZS5ncmFudFJlYWREYXRhKGxpc3RGaWxlc0Z1bmN0aW9uKTtcblxuICAgIC8vIENyZWF0ZSBBSSBJbnNpZ2h0cyBMYW1iZGEgZnVuY3Rpb24gaWYgZW5hYmxlZFxuICAgIGlmIChlbmFibGVBSUluc2lnaHRzKSB7XG4gICAgICB0aGlzLmluc2lnaHRzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdJbnNpZ2h0c0Z1bmN0aW9uJywge1xuICAgICAgICBmdW5jdGlvbk5hbWU6IGAke2FwcGxpY2F0aW9uTmFtZX0tJHtlbnZpcm9ubWVudH0taW5zaWdodHNgLFxuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2xhbWJkYS9pbnNpZ2h0cycpKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTIwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBEQVRBX1RBQkxFX05BTUU6IHRoaXMuZGF0YVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICBEQVRBX0JVQ0tFVF9OQU1FOiB0aGlzLmRhdGFCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgfSxcbiAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICB9KTtcblxuICAgICAgLy8gR3JhbnQgQmVkcm9jayBwZXJtaXNzaW9ucyB0byBpbnNpZ2h0cyBmdW5jdGlvblxuICAgICAgdGhpcy5pbnNpZ2h0c0Z1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbScsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sIC8vIFlvdSBjYW4gcmVzdHJpY3QgdGhpcyB0byBzcGVjaWZpYyBtb2RlbCBBUk5zXG4gICAgICB9KSk7XG5cbiAgICAgIC8vIEdyYW50IG90aGVyIG5lY2Vzc2FyeSBwZXJtaXNzaW9uc1xuICAgICAgdGhpcy5kYXRhVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHRoaXMuaW5zaWdodHNGdW5jdGlvbik7XG4gICAgICB0aGlzLmRhdGFCdWNrZXQuZ3JhbnRSZWFkKHRoaXMuaW5zaWdodHNGdW5jdGlvbik7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIEFQSSBHYXRld2F5XG4gICAgdGhpcy5hcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdDb3J0ZXhBSUFQSScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiBgJHthcHBsaWNhdGlvbk5hbWV9LSR7ZW52aXJvbm1lbnR9LWFwaWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvcnRleEFJIE11bHRpLXRlbmFudCBBUEknLFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbJ0NvbnRlbnQtVHlwZScsICdBdXRob3JpemF0aW9uJywgJ1gtVGVuYW50LUlEJ10sXG4gICAgICB9LFxuICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICBzdGFnZU5hbWU6IGVudmlyb25tZW50LFxuICAgICAgICAvLyBEaXNhYmxlIGxvZ2dpbmcgdG8gYXZvaWQgQ2xvdWRXYXRjaCBMb2dzIHJvbGUgcmVxdWlyZW1lbnRcbiAgICAgICAgLy8gbG9nZ2luZ0xldmVsOiBhcGlnYXRld2F5Lk1ldGhvZExvZ2dpbmdMZXZlbC5JTkZPLFxuICAgICAgICAvLyBkYXRhVHJhY2VFbmFibGVkOiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBDb2duaXRvIEF1dGhvcml6ZXJcbiAgICBjb25zdCBhdXRob3JpemVyID0gbmV3IGFwaWdhdGV3YXkuQ29nbml0b1VzZXJQb29sc0F1dGhvcml6ZXIodGhpcywgJ0NvZ25pdG9BdXRob3JpemVyJywge1xuICAgICAgY29nbml0b1VzZXJQb29sczogW3RoaXMudXNlclBvb2xdLFxuICAgICAgYXV0aG9yaXplck5hbWU6IGAke2FwcGxpY2F0aW9uTmFtZX0tJHtlbnZpcm9ubWVudH0tYXV0aG9yaXplcmAsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQVBJIHJlc291cmNlcyBhbmQgbWV0aG9kc1xuICAgIGNvbnN0IHVwbG9hZFJlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZSgndXBsb2FkJyk7XG4gICAgY29uc3QgdXBsb2FkSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbih0aGlzLnVwbG9hZEZ1bmN0aW9uLCB7XG4gICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBcIicqJ1wiLFxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6IFwiJ0NvbnRlbnQtVHlwZSxYLUFtei1EYXRlLEF1dGhvcml6YXRpb24sWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtVGVuYW50LUlEJ1wiLFxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IFwiJ1BPU1QsT1BUSU9OUydcIixcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBcbiAgICB1cGxvYWRSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCB1cGxvYWRJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcjogYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAnbWV0aG9kLnJlcXVlc3QuaGVhZGVyLlgtVGVuYW50LUlEJzogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogdHJ1ZSxcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiB0cnVlLFxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgZmlsZXMgbGlzdGluZyBlbmRwb2ludFxuICAgIGNvbnN0IGZpbGVzUmVzb3VyY2UgPSB0aGlzLmFwaS5yb290LmFkZFJlc291cmNlKCdmaWxlcycpO1xuICAgIGNvbnN0IGZpbGVzSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihsaXN0RmlsZXNGdW5jdGlvbiwge1xuICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogXCInKidcIixcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiBcIidDb250ZW50LVR5cGUsWC1BbXotRGF0ZSxBdXRob3JpemF0aW9uLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVRlbmFudC1JRCdcIixcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiBcIidHRVQsT1BUSU9OUydcIixcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHtcbiAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiAne1widGVuYW50SWRcIjogXCIkaW5wdXQucGFyYW1zKFxcJ1gtVGVuYW50LUlEXFwnKVwiLCBcInF1ZXJ5UGFyYW1zXCI6ICRpbnB1dC5wYXJhbXMoKS5xdWVyeXN0cmluZywgXCJoZWFkZXJzXCI6ICRpbnB1dC5wYXJhbXMoKS5oZWFkZXJ9JyxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgXG4gICAgZmlsZXNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGZpbGVzSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6ZXI6IGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPLFxuICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgJ21ldGhvZC5yZXF1ZXN0LmhlYWRlci5YLVRlbmFudC1JRCc6IHRydWUsXG4gICAgICB9LFxuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogdHJ1ZSxcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGluc2lnaHRzIGVuZHBvaW50IGlmIEFJIGluc2lnaHRzIGlzIGVuYWJsZWRcbiAgICBpZiAoZW5hYmxlQUlJbnNpZ2h0cyAmJiB0aGlzLmluc2lnaHRzRnVuY3Rpb24pIHtcbiAgICAgIGNvbnN0IGluc2lnaHRzUmVzb3VyY2UgPSB0aGlzLmFwaS5yb290LmFkZFJlc291cmNlKCdpbnNpZ2h0cycpO1xuICAgICAgY29uc3QgaW5zaWdodHNJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHRoaXMuaW5zaWdodHNGdW5jdGlvbiwge1xuICAgICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJyonXCIsXG4gICAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiBcIidDb250ZW50LVR5cGUsWC1BbXotRGF0ZSxBdXRob3JpemF0aW9uLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVRlbmFudC1JRCdcIixcbiAgICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IFwiJ0dFVCxPUFRJT05TJ1wiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7XG4gICAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiAne1wiZGF0YUlkXCI6IFwiJGlucHV0LnBhcmFtcyhcXCdkYXRhSWRcXCcpXCIsIFwicHJvbXB0XCI6IFwiJGlucHV0LnBhcmFtcyhcXCdwcm9tcHRcXCcpXCIsIFwicXVlcnlQYXJhbXNcIjogJGlucHV0LnBhcmFtcygpLnF1ZXJ5c3RyaW5nLCBcImhlYWRlcnNcIjogJGlucHV0LnBhcmFtcygpLmhlYWRlcn0nLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGluc2lnaHRzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBpbnNpZ2h0c0ludGVncmF0aW9uLCB7XG4gICAgICAgIGF1dGhvcml6ZXI6IGF1dGhvcml6ZXIsXG4gICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgJ21ldGhvZC5yZXF1ZXN0LnF1ZXJ5c3RyaW5nLmRhdGFJZCc6IHRydWUsXG4gICAgICAgICAgJ21ldGhvZC5yZXF1ZXN0LnF1ZXJ5c3RyaW5nLnByb21wdCc6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiB0cnVlLFxuICAgICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogdHJ1ZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEFkZCBoZWFsdGggY2hlY2sgZW5kcG9pbnRcbiAgICBjb25zdCBoZWFsdGhSZXNvdXJjZSA9IHRoaXMuYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2hlYWx0aCcpO1xuICAgIGhlYWx0aFJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTW9ja0ludGVncmF0aW9uKHtcbiAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbe1xuICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgcmVzcG9uc2VUZW1wbGF0ZXM6IHtcbiAgICAgICAgICAnYXBwbGljYXRpb24vanNvbic6IEpTT04uc3RyaW5naWZ5KHsgc3RhdHVzOiAnaGVhbHRoeScsIHRpbWVzdGFtcDogJyRjb250ZXh0LnJlcXVlc3RUaW1lJyB9KSxcbiAgICAgICAgfSxcbiAgICAgIH1dLFxuICAgICAgcmVxdWVzdFRlbXBsYXRlczoge1xuICAgICAgICAnYXBwbGljYXRpb24vanNvbic6ICd7XCJzdGF0dXNDb2RlXCI6IDIwMH0nLFxuICAgICAgfSxcbiAgICB9KSwge1xuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbeyBzdGF0dXNDb2RlOiAnMjAwJyB9XSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBFdmVudEJyaWRnZSBydWxlIHRvIHRyaWdnZXIgcHJvY2Vzc2luZyBmdW5jdGlvblxuICAgIGNvbnN0IHByb2Nlc3NSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdQcm9jZXNzUnVsZScsIHtcbiAgICAgIGV2ZW50QnVzOiB0aGlzLmV2ZW50QnVzLFxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIHNvdXJjZTogWydjb3J0ZXgtYWkudXBsb2FkJ10sXG4gICAgICAgIGRldGFpbFR5cGU6IFsnRGF0YVVwbG9hZGVkJ10sXG4gICAgICB9LFxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRoaXMucHJvY2Vzc0Z1bmN0aW9uKV0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgRXZlbnRCcmlkZ2UgcnVsZSB0byB0cmlnZ2VyIEFJIGluc2lnaHRzIGlmIGVuYWJsZWRcbiAgICBpZiAoZW5hYmxlQUlJbnNpZ2h0cyAmJiB0aGlzLmluc2lnaHRzRnVuY3Rpb24pIHtcbiAgICAgIGNvbnN0IGluc2lnaHRzUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnSW5zaWdodHNSdWxlJywge1xuICAgICAgICBldmVudEJ1czogdGhpcy5ldmVudEJ1cyxcbiAgICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgICAgc291cmNlOiBbJ2NvcnRleC1haS5wcm9jZXNzJ10sXG4gICAgICAgICAgZGV0YWlsVHlwZTogWydEYXRhUHJvY2Vzc2VkJ10sXG4gICAgICAgIH0sXG4gICAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0aGlzLmluc2lnaHRzRnVuY3Rpb24pXSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBJQU0gcG9saWN5IGZvciB0ZW5hbnQgYWNjZXNzIGNvbnRyb2xcbiAgICBjb25zdCB0ZW5hbnRBY2Nlc3NQb2xpY3kgPSBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgICAgICdzMzpQdXRPYmplY3QnLFxuICAgICAgICAgICAgJ3MzOkRlbGV0ZU9iamVjdCcsXG4gICAgICAgICAgICAnczM6TGlzdEJ1Y2tldCcsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgIHRoaXMuZGF0YUJ1Y2tldC5idWNrZXRBcm4sXG4gICAgICAgICAgICBgJHt0aGlzLmRhdGFCdWNrZXQuYnVja2V0QXJufS8qYCxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICAgICdTdHJpbmdFcXVhbHMnOiB7XG4gICAgICAgICAgICAgICdhd3M6UHJpbmNpcGFsVGFnL3RlbmFudElkJzogJyR7YXdzOlByaW5jaXBhbFRhZy90ZW5hbnRJZH0nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICdTdHJpbmdMaWtlJzoge1xuICAgICAgICAgICAgICAnczM6cHJlZml4JzogJyR7YXdzOlByaW5jaXBhbFRhZy90ZW5hbnRJZH0vKicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdkeW5hbW9kYjpHZXRJdGVtJyxcbiAgICAgICAgICAgICdkeW5hbW9kYjpQdXRJdGVtJyxcbiAgICAgICAgICAgICdkeW5hbW9kYjpVcGRhdGVJdGVtJyxcbiAgICAgICAgICAgICdkeW5hbW9kYjpEZWxldGVJdGVtJyxcbiAgICAgICAgICAgICdkeW5hbW9kYjpRdWVyeScsXG4gICAgICAgICAgICAnZHluYW1vZGI6U2NhbicsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgIHRoaXMuZGF0YVRhYmxlLnRhYmxlQXJuLFxuICAgICAgICAgICAgYCR7dGhpcy5kYXRhVGFibGUudGFibGVBcm59L2luZGV4LypgLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgJ1N0cmluZ0VxdWFscyc6IHtcbiAgICAgICAgICAgICAgJ2R5bmFtb2RiOkxlYWRpbmdLZXlzJzogJyR7YXdzOlByaW5jaXBhbFRhZy90ZW5hbnRJZH0nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgSUFNIHJvbGVzIGZvciBhdXRoZW50aWNhdGVkIHVzZXJzXG4gICAgY29uc3QgYXV0aGVudGljYXRlZFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0F1dGhlbnRpY2F0ZWRSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbCgnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tJywge1xuICAgICAgICAnU3RyaW5nRXF1YWxzJzoge1xuICAgICAgICAgICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkJzogdGhpcy5pZGVudGl0eVBvb2wucmVmLFxuICAgICAgICB9LFxuICAgICAgICAnRm9yQW55VmFsdWU6U3RyaW5nTGlrZSc6IHtcbiAgICAgICAgICAnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tOmFtcic6ICdhdXRoZW50aWNhdGVkJyxcbiAgICAgICAgfSxcbiAgICAgIH0sICdzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eScpLFxuICAgICAgZGVzY3JpcHRpb246ICdSb2xlIGZvciBhdXRoZW50aWNhdGVkIHVzZXJzIGluIENvcnRleEFJJyxcbiAgICB9KTtcblxuICAgIC8vIEF0dGFjaCB0aGUgdGVuYW50IGFjY2VzcyBwb2xpY3kgdG8gdGhlIGF1dGhlbnRpY2F0ZWQgcm9sZVxuICAgIGF1dGhlbnRpY2F0ZWRSb2xlLmF0dGFjaElubGluZVBvbGljeShuZXcgaWFtLlBvbGljeSh0aGlzLCAnVGVuYW50QWNjZXNzUG9saWN5Jywge1xuICAgICAgZG9jdW1lbnQ6IHRlbmFudEFjY2Vzc1BvbGljeSxcbiAgICB9KSk7XG5cbiAgICAvLyBBdHRhY2ggdGhlIGF1dGhlbnRpY2F0ZWQgcm9sZSB0byB0aGUgSWRlbnRpdHkgUG9vbFxuICAgIG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50KHRoaXMsICdJZGVudGl0eVBvb2xSb2xlQXR0YWNobWVudCcsIHtcbiAgICAgIGlkZW50aXR5UG9vbElkOiB0aGlzLmlkZW50aXR5UG9vbC5yZWYsXG4gICAgICByb2xlczoge1xuICAgICAgICBhdXRoZW50aWNhdGVkOiBhdXRoZW50aWNhdGVkUm9sZS5yb2xlQXJuLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dCBpbXBvcnRhbnQgdmFsdWVzIGZvciBmcm9udGVuZCBjb25maWd1cmF0aW9uXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHthcHBsaWNhdGlvbk5hbWV9LSR7ZW52aXJvbm1lbnR9LXVzZXItcG9vbC1pZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIENsaWVudCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHthcHBsaWNhdGlvbk5hbWV9LSR7ZW52aXJvbm1lbnR9LXVzZXItcG9vbC1jbGllbnQtaWRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0lkZW50aXR5UG9vbElkJywge1xuICAgICAgdmFsdWU6IHRoaXMuaWRlbnRpdHlQb29sLnJlZixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBJZGVudGl0eSBQb29sIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke2FwcGxpY2F0aW9uTmFtZX0tJHtlbnZpcm9ubWVudH0taWRlbnRpdHktcG9vbC1pZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGF0YVRhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmRhdGFUYWJsZS50YWJsZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIERhdGEgVGFibGUgTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgJHthcHBsaWNhdGlvbk5hbWV9LSR7ZW52aXJvbm1lbnR9LWRhdGEtdGFibGUtbmFtZWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGF0YUJ1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kYXRhQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIERhdGEgQnVja2V0IE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7YXBwbGljYXRpb25OYW1lfS0ke2Vudmlyb25tZW50fS1kYXRhLWJ1Y2tldC1uYW1lYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlHYXRld2F5VXJsJywge1xuICAgICAgdmFsdWU6IHRoaXMuYXBpLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIEdhdGV3YXkgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke2FwcGxpY2F0aW9uTmFtZX0tJHtlbnZpcm9ubWVudH0tYXBpLXVybGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRXZlbnRCdXNOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdFdmVudEJyaWRnZSBFdmVudCBCdXMgTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgJHthcHBsaWNhdGlvbk5hbWV9LSR7ZW52aXJvbm1lbnR9LWV2ZW50LWJ1cy1uYW1lYCxcbiAgICB9KTtcbiAgfVxufVxuIl19