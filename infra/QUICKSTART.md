# CortexAI Quick Start Guide

Get up and running with CortexAI in under 10 minutes!

## 🚀 Prerequisites

- Node.js 18+ installed
- AWS CLI configured with appropriate permissions
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

## ⚡ Quick Start

### 1. Clone and Setup
```bash
cd CortexAI
npm install
```

### 2. Build Lambda Functions
```bash
# Build all Lambda functions
cd lambda/upload && npm install && npm run build && cd ../..
cd lambda/process && npm install && npm run build && cd ../..
cd lambda/insights && npm install && npm run build && cd ../..
```

### 3. Deploy to Development
```bash
# Use the deployment script
./scripts/deploy.sh -e dev

# Or deploy manually
npx cdk deploy --context environment=dev
```

### 4. Test the API
```bash
# Get your API Gateway URL from the CDK outputs
# Test the health endpoint
curl https://your-api-url/health

# Test upload (you'll need a Cognito token)
curl -X POST https://your-api-url/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-ID: test-tenant" \
  -H "Content-Type: application/json" \
  -d '{"dataType": "customer", "data": {"name": "John Doe"}}'
```

## 🔧 Configuration

### Environment Variables
```bash
export AWS_DEFAULT_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT=your-account-id
export CDK_DEFAULT_REGION=us-east-1
```

### Custom Configuration
```typescript
// examples/custom-config.ts
import { CortexAIStack } from '../lib/cortex-ai-stack';

new CortexAIStack(app, 'CustomCortexAI', {
  environment: 'dev',
  applicationName: 'my-custom-app',
  enableAIInsights: true,
  cognitoConfig: {
    userPoolName: 'my-users',
    userPoolClientName: 'my-client',
  },
});
```

## 📊 What Gets Created

- **Cognito User Pool** - Authentication
- **DynamoDB Table** - Multi-tenant data storage
- **S3 Bucket** - Data file storage
- **API Gateway** - REST API endpoints
- **Lambda Functions** - Data processing pipeline
- **EventBridge** - Event-driven architecture
- **IAM Roles** - Least-privilege permissions

## 🔐 First User Setup

1. Go to AWS Console → Cognito → User Pools
2. Find your user pool (named `cortex-ai-dev-users`)
3. Create a user with email and password
4. Set custom attributes:
   - `tenantId`: `test-tenant`
   - `role`: `admin`

## 📝 Sample Data Types

### Customer Data
```json
{
  "dataType": "customer",
  "data": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "company": "Acme Corp"
  }
}
```

### Transaction Data
```json
{
  "dataType": "transaction",
  "data": {
    "amount": 99.99,
    "currency": "USD",
    "timestamp": "2024-01-15T10:30:00Z",
    "category": "electronics"
  }
}
```

### Product Data
```json
{
  "dataType": "product",
  "data": {
    "name": "Laptop",
    "price": 1299.99,
    "category": "electronics",
    "inStock": true
  }
}
```

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
# Test the complete pipeline
# 1. Upload data
# 2. Check processing status
# 3. Verify AI insights (if enabled)
```

### Load Testing
```bash
# Use tools like Artillery or k6
artillery run load-test.yml
```

## 🚨 Common Issues

### CDK Bootstrap Required
```bash
cdk bootstrap
```

### Lambda Build Errors
```bash
# Ensure all dependencies are installed
cd lambda/upload && npm install && cd ../..
cd lambda/process && npm install && cd ../..
cd lambda/insights && npm install && cd ../..
```

### Permission Errors
- Verify AWS credentials
- Check IAM permissions
- Ensure CDK has necessary permissions

## 📚 Next Steps

1. **Customize Data Types** - Add your own data schemas
2. **Extend Processing** - Add custom business logic
3. **Custom AI Models** - Integrate with other AI services
4. **Monitoring** - Set up CloudWatch alarms and dashboards
5. **CI/CD** - Integrate with your deployment pipeline

## 🆘 Need Help?

- Check the [main README.md](README.md)
- Review CloudWatch logs for errors
- Check AWS CDK documentation
- Create an issue in the repository

---

**Happy building! 🚀**
