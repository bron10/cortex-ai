# CortexAI Monorepo

A complete multi-tenant AI-powered data processing platform with AWS CDK infrastructure and Next.js frontend.[Learn more](https://webvictory.hashnode.dev/cortexai-building-tenant-aware-ai-insights-on-aws)

## 🏗️ Architecture

```
CortexAI/
├── 📁 infra/                    # AWS CDK Infrastructure
│   ├── 📁 bin/                 # CDK App Entry Points
│   ├── 📁 lib/                 # CDK Constructs & Stacks
│   ├── 📁 lambda/              # Lambda Functions
│   └── 📁 scripts/             # Deployment Scripts
├── 📁 frontend/                # Next.js Frontend
│   ├── 📁 src/                 # Source Code
│   ├── 📁 public/              # Static Assets
│   └── 📁 .env.local           # Environment Variables (auto-generated)
└── 📄 package.json             # Monorepo Configuration
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- AWS CLI configured
- AWS CDK CLI installed

### 1. Install Dependencies
```bash
npm install
```

### 2. Build Everything
```bash
npm run build
```

### 3. Deploy Infrastructure
```bash
npm run deploy:infra
```

### 4. Start Frontend Development
```bash
npm run dev
```

## 📋 Features

### 🔐 Multi-tenant Authentication
- AWS Cognito User Pool with custom attributes
- Identity Pool for AWS service access
- Tenant isolation through custom attributes

### 🗄️ Data Storage
- DynamoDB with tenant-based partitioning
- S3 bucket with tenant-prefixed paths
- Automatic data lifecycle management

### 🤖 AI Processing Pipeline
- Event-driven data processing
- Amazon Bedrock integration for AI insights
- Configurable processing workflows

### 🌐 Frontend Features
- Next.js 14 with TypeScript
- AWS Amplify UI for authentication
- Real-time file upload and processing status
- AI insights visualization

## 🛠️ Development

### Infrastructure (CDK)
```bash
cd infra

# Build Lambda functions
cd lambda/upload && npm install && npm run build && cd ../..
cd lambda/process && npm install && npm run build && cd ../..
cd lambda/insights && npm install && npm run build && cd ../..

# Deploy to development
npm run deploy

# View changes
npm run diff
```

### Frontend (Next.js)
```bash
cd frontend

# Start development server
npm run dev

# Build for production
npm run build
```

## 🔧 Configuration

### Environment Variables
After deployment, the infrastructure automatically generates:
- `frontend/.env.local` - Frontend environment variables
- `frontend/src/config/aws-config.ts` - AWS Amplify configuration

### Custom Configuration
```typescript
// infra/bin/cortex-ai.ts
new CortexAIStack(app, 'CustomCortexAI', {
  environment: 'prod',
  applicationName: 'my-enterprise-ai',
  enableAIInsights: true,
  cognitoConfig: {
    userPoolName: 'enterprise-users',
  },
});
```

## 📊 Data Flow

1. **User Authentication** → Cognito → Identity Pool
2. **File Upload** → Next.js → API Gateway → Lambda → S3 + DynamoDB
3. **Data Processing** → EventBridge → Lambda → Analysis
4. **AI Insights** → EventBridge → Lambda → Bedrock → Storage
5. **Frontend Display** → API Gateway → Next.js

## 🔐 Security

### Tenant Isolation
- DynamoDB partition keys based on tenantId
- S3 object prefixes for tenant separation
- IAM policies with tenant-specific conditions

### Authentication Flow
- Cognito User Pool for user management
- JWT tokens for API access
- Identity Pool for AWS service access

## 🚀 Deployment

### Infrastructure Deployment
```bash
# Deploy to different environments
npm run deploy:infra -- --context environment=dev
npm run deploy:infra -- --context environment=staging
npm run deploy:infra -- --context environment=prod
```

### Frontend Deployment
```bash
# Build and deploy frontend
npm run deploy:frontend
```

### Complete Deployment
```bash
# Deploy everything
npm run deploy:all
```

## 🧪 Testing

### Manual Testing
1. **Deploy infrastructure**
2. **Create test user in Cognito**
3. **Upload JSON files through frontend**
4. **Monitor processing pipeline**
5. **View AI insights**

### API Testing
```bash
# Test health endpoint
curl https://your-api-url/health

# Test upload (with auth token)
curl -X POST https://your-api-url/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-ID: tenant-123" \
  -H "Content-Type: application/json" \
  -d '{"dataType": "customer", "data": {...}}'
```

## 📈 Monitoring

### CloudWatch Logs
- Lambda function execution logs
- API Gateway access logs
- Application performance metrics

### EventBridge Events
- Data upload events
- Processing pipeline events
- AI insights generation events

## 🔄 CI/CD

### GitHub Actions Example
```yaml
name: Deploy CortexAI
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - run: npm run deploy:all
```

## 🚨 Troubleshooting

### Common Issues
1. **CDK Bootstrap Required**
   ```bash
   cdk bootstrap
   ```

2. **Lambda Build Errors**
   ```bash
   cd infra/lambda/upload && npm install && npm run build
   ```

3. **Frontend Configuration Missing**
   ```bash
   npm run deploy:infra  # This generates frontend config
   ```

### Debug Mode
```bash
export CDK_DEBUG=1
npm run deploy:infra
```

## 📚 Documentation

- [Infrastructure Documentation](infra/README.md)
- [Frontend Documentation](frontend/README.md)
- [API Reference](infra/README.md#api-reference)
- [Deployment Guide](infra/QUICKSTART.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

---

**Built with ❤️ using AWS CDK and Next.js**
