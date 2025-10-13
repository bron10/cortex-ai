# CortexAI - Multi-tenant AI-Powered Data Processing Platform

A reusable AWS CDK (TypeScript) construct that provides a complete multi-tenant data processing platform with AI-powered insights using Amazon Bedrock.

## 🏗️ Architecture Overview

The CortexAI platform implements a multi-tenant architecture with the following key components:

- **AWS Cognito**: Tenant authentication and user management
- **DynamoDB**: Multi-tenant data storage with tenantId as partition key
- **S3**: Shared data storage with tenant-prefixed paths
- **API Gateway**: RESTful API with Cognito authorization
- **Lambda Functions**: Serverless data processing pipeline
- **EventBridge**: Decoupled event-driven architecture
- **Amazon Bedrock**: AI-powered data insights and analysis

## 🚀 Features

### Multi-tenant Design
- Each tenant has isolated data access through tenantId-based partitioning
- Shared infrastructure with tenant-level data isolation
- Configurable tenant management policies

### Data Processing Pipeline
1. **Upload**: JSON data upload with tenant validation
2. **Process**: Automated data processing and quality scoring
3. **Insights**: AI-powered analysis using Amazon Bedrock (optional)

### Security & Compliance
- IAM policies enforcing tenant data isolation
- Cognito-based authentication and authorization
- S3 bucket policies with tenant-specific access controls
- Least-privilege permissions for all resources

### Scalability
- Pay-per-request DynamoDB billing
- Auto-scaling Lambda functions
- Event-driven architecture for decoupled processing

## 📁 Project Structure

```
CortexAI/
├── bin/                    # CDK app entrypoint
│   └── cortex-ai.ts      # Main CDK app
├── lib/                   # CDK constructs
│   ├── cortex-ai.ts      # Main CortexAI construct
│   └── cortex-ai-stack.ts # CortexAI stack
├── lambda/                # Lambda function code
│   ├── upload/           # Data upload handler
│   ├── process/          # Data processing handler
│   └── insights/         # AI insights handler
├── package.json          # Project dependencies
├── tsconfig.json         # TypeScript configuration
├── cdk.json             # CDK configuration
└── README.md            # This file
```

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 18+ 
- AWS CDK CLI
- AWS credentials configured
- TypeScript knowledge

### 1. Install Dependencies
```bash
cd CortexAI
npm install
```

### 2. Build Lambda Functions
```bash
# Build all Lambda functions
cd lambda/upload && npm install && npm run build
cd ../process && npm install && npm run build
cd ../insights && npm install && npm run build
cd ../..
```

### 3. Deploy the Stack
```bash
# Deploy to dev environment
npx cdk deploy --context environment=dev

# Deploy to production
npx cdk deploy --context environment=prod
```

## 🔧 Configuration Options

### Basic Usage
```typescript
import { CortexAIStack } from './lib/cortex-ai-stack';

const app = new cdk.App();

new CortexAIStack(app, 'MyCortexAI', {
  environment: 'dev',
  applicationName: 'my-app',
  enableAIInsights: true,
});
```

### Advanced Configuration
```typescript
new CortexAIStack(app, 'MyCortexAI', {
  environment: 'prod',
  applicationName: 'enterprise-ai',
  enableAIInsights: true,
  cognitoConfig: {
    userPoolName: 'enterprise-users',
    userPoolClientName: 'enterprise-client',
  },
  dynamoConfig: {
    billingMode: 'PROVISIONED',
    removalPolicy: 'RETAIN',
  },
  s3Config: {
    versioned: true,
    removalPolicy: 'RETAIN',
  },
});
```

## 📊 Data Flow

### 1. Data Upload
```
Client → API Gateway → Cognito Auth → Upload Lambda → S3 + DynamoDB → EventBridge
```

### 2. Data Processing
```
EventBridge → Process Lambda → S3 Read → Data Analysis → DynamoDB Update → EventBridge
```

### 3. AI Insights (Optional)
```
EventBridge → Insights Lambda → Bedrock API → AI Analysis → DynamoDB Update
```

## 🔐 Security Features

### Tenant Isolation
- **DynamoDB**: Partition key based on tenantId
- **S3**: Prefix-based access control (`s3://bucket/{tenantId}/`)
- **IAM**: Conditional policies enforcing tenant boundaries

### Authentication
- Cognito User Pool with custom attributes
- JWT tokens for API access
- Multi-factor authentication support

### Authorization
- API Gateway with Cognito authorizer
- Tenant-specific data access policies
- Role-based access control

## 📈 Monitoring & Observability

### CloudWatch Logs
- All Lambda functions log to CloudWatch
- Structured logging with tenant context
- Log retention configurable per environment

### Metrics & Alarms
- DynamoDB read/write capacity monitoring
- S3 bucket metrics and access patterns
- Lambda function performance metrics

### Event Tracking
- EventBridge for workflow monitoring
- Tenant-specific event correlation
- Processing pipeline visibility

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### CDK Diff
```bash
npx cdk diff
```

### Manual Testing
```bash
# Test the API endpoints
curl -X POST https://your-api-gateway-url/upload \
  -H "Authorization: Bearer YOUR_COGNITO_TOKEN" \
  -H "X-Tenant-ID: tenant-123" \
  -H "Content-Type: application/json" \
  -d '{"dataType": "customer", "data": {"name": "John Doe", "email": "john@example.com"}}'
```

## 🚀 Deployment Strategies

### Environment-Specific Deployments
```bash
# Development
npx cdk deploy --context environment=dev

# Staging
npx cdk deploy --context environment=staging

# Production
npx cdk deploy --context environment=prod
```

### Blue-Green Deployment
- Use CDK's built-in deployment mechanisms
- Zero-downtime updates
- Rollback capabilities

## 🔄 CI/CD Integration

### Bitbucket Pipelines
```yaml
pipelines:
  default:
    - step:
        name: Deploy to Dev
        script:
          - npm install
          - npm run build
          - npx cdk deploy --context environment=dev
```

### GitHub Actions
```yaml
- name: Deploy to AWS
  run: |
    npm install
    npm run build
    npx cdk deploy --context environment=${{ github.ref_name }}
```

## 📋 API Reference

### Upload Endpoint
```
POST /upload
Headers: 
  - Authorization: Bearer <cognito-token>
  - X-Tenant-ID: <tenant-id>
  - Content-Type: application/json

Body:
{
  "dataType": "customer|transaction|product|log",
  "data": {...},
  "metadata": {...}
}
```

### Health Check
```
GET /health
Response: {"status": "healthy", "timestamp": "..."}
```

## 🎯 Use Cases

### E-commerce Analytics
- Customer behavior analysis
- Transaction pattern recognition
- Product performance insights

### Financial Services
- Risk assessment
- Fraud detection
- Portfolio analysis

### Healthcare
- Patient data processing
- Medical record analysis
- Treatment outcome insights

### Manufacturing
- Quality control data
- Production metrics
- Predictive maintenance

## 🔧 Customization

### Adding New Data Types
1. Extend the `processDataByType` function in `lambda/process/index.ts`
2. Add type-specific processing logic
3. Update quality scoring algorithms

### Custom AI Models
1. Modify the Bedrock model selection in `lambda/insights/index.ts`
2. Adjust prompts for domain-specific analysis
3. Implement custom response parsing

### Additional Services
1. Create new Lambda functions
2. Add EventBridge rules for new workflows
3. Extend the CDK construct with new resources

## 🚨 Troubleshooting

### Common Issues

#### Lambda Function Errors
- Check CloudWatch logs for detailed error messages
- Verify IAM permissions
- Check environment variables

#### DynamoDB Issues
- Verify table creation and permissions
- Check partition key configuration
- Monitor read/write capacity

#### S3 Access Issues
- Verify bucket policies
- Check CORS configuration
- Validate tenant prefix structure

### Debug Mode
```bash
# Enable verbose logging
export CDK_DEBUG=1
npx cdk deploy
```

## 📚 Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Amazon Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review AWS documentation
- Contact the development team

---

**Note**: This is a production-ready construct that follows AWS best practices and security guidelines. Always review and customize the configuration for your specific use case and compliance requirements.
