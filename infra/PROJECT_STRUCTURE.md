# CortexAI Project Structure

This document provides a comprehensive overview of the CortexAI project structure and organization.

## 📁 Directory Structure

```
CortexAI/
├── 📁 bin/                          # CDK App Entry Points
│   ├── cortex-ai.ts                # Main CDK application
│   └── examples/                    # Example configurations
│       └── basic-usage.ts          # Basic usage examples
│
├── 📁 lib/                          # CDK Constructs & Stacks
│   ├── cortex-ai.ts                # Main CortexAI construct
│   └── cortex-ai-stack.ts          # CortexAI stack implementation
│
├── 📁 lambda/                       # Lambda Function Code
│   ├── 📁 upload/                  # Data upload handler
│   │   ├── index.ts                # Main handler function
│   │   ├── package.json            # Dependencies
│   │   └── tsconfig.json           # TypeScript config
│   │
│   ├── 📁 process/                 # Data processing handler
│   │   ├── index.ts                # Main handler function
│   │   ├── package.json            # Dependencies
│   │   └── tsconfig.json           # TypeScript config
│   │
│   └── 📁 insights/                # AI insights handler
│       ├── index.ts                # Main handler function
│       ├── package.json            # Dependencies
│       └── tsconfig.json           # TypeScript config
│
├── 📁 scripts/                      # Deployment & Utility Scripts
│   ├── deploy.sh                   # Main deployment script
│   └── test-setup.sh               # Setup verification script
│
├── 📁 examples/                     # Usage Examples
│   └── basic-usage.ts              # Basic configuration examples
│
├── 📄 package.json                  # Main project dependencies
├── 📄 tsconfig.json                 # TypeScript configuration
├── 📄 cdk.json                     # CDK configuration
├── 📄 README.md                     # Comprehensive documentation
├── 📄 QUICKSTART.md                 # Quick start guide
└── 📄 PROJECT_STRUCTURE.md          # This file
```

## 🏗️ Architecture Components

### Core CDK Constructs
- **`CortexAI`** - Main construct containing all AWS resources
- **`CortexAIStack`** - CDK stack wrapper for easy deployment

### AWS Resources Created
1. **Cognito User Pool** - Multi-tenant authentication
2. **DynamoDB Table** - Tenant-isolated data storage
3. **S3 Bucket** - Tenant-prefixed data storage
4. **API Gateway** - RESTful API with Cognito auth
5. **Lambda Functions** - Serverless data processing pipeline
6. **EventBridge** - Event-driven architecture
7. **IAM Roles & Policies** - Least-privilege security

### Lambda Functions
1. **Upload Function** - Handles data uploads and validation
2. **Process Function** - Processes uploaded data and calculates metrics
3. **Insights Function** - Generates AI insights using Amazon Bedrock

## 🔧 Configuration Files

### Main Configuration
- **`package.json`** - Node.js dependencies and scripts
- **`tsconfig.json`** - TypeScript compiler options
- **`cdk.json`** - CDK framework configuration

### Lambda Configuration
Each Lambda function has its own:
- **`package.json`** - Function-specific dependencies
- **`tsconfig.json`** - TypeScript compilation settings

## 📚 Documentation Files

### User Documentation
- **`README.md`** - Comprehensive project documentation
- **`QUICKSTART.md`** - Quick start guide for developers
- **`PROJECT_STRUCTURE.md`** - This structural overview

### Code Documentation
- **Inline JSDoc** - All functions and classes documented
- **TypeScript interfaces** - Clear type definitions
- **Configuration examples** - Practical usage scenarios

## 🚀 Deployment & Scripts

### Deployment Scripts
- **`deploy.sh`** - Automated deployment with environment support
- **`test-setup.sh`** - Environment and dependency verification

### Script Features
- Environment-specific deployments (dev/staging/prod)
- Automatic dependency installation
- Lambda function building
- CDK bootstrap checking
- Interactive deployment confirmation

## 🔐 Security & Best Practices

### Multi-tenant Isolation
- DynamoDB partition key based on tenantId
- S3 prefix-based access control
- IAM policies with tenant-specific conditions

### Authentication & Authorization
- Cognito User Pool with custom attributes
- JWT token validation
- Role-based access control

### Least Privilege
- Minimal IAM permissions for each resource
- Conditional policies for tenant isolation
- Secure by default configurations

## 📊 Data Flow Architecture

```
Client Request → API Gateway → Cognito Auth → Upload Lambda
                                                    ↓
                                            S3 + DynamoDB
                                                    ↓
                                            EventBridge Event
                                                    ↓
                                            Process Lambda
                                                    ↓
                                            Data Analysis
                                                    ↓
                                            EventBridge Event
                                                    ↓
                                            Insights Lambda (optional)
                                                    ↓
                                            Amazon Bedrock
                                                    ↓
                                            AI Insights Storage
```

## 🧪 Testing & Validation

### Setup Testing
- **`test-setup.sh`** - Verifies all dependencies and configurations
- Node.js version checking
- AWS credentials validation
- CDK bootstrap status
- Lambda function building

### Deployment Testing
- **`deploy.sh`** - Automated deployment with validation
- Environment-specific configurations
- Resource creation verification
- Output value extraction

## 🔄 CI/CD Integration

### Supported Platforms
- **Bitbucket Pipelines** - Example configuration provided
- **GitHub Actions** - Example workflow provided
- **Generic CDK** - Platform-agnostic deployment

### Deployment Strategies
- Environment-specific stacks
- Blue-green deployment support
- Rollback capabilities
- Infrastructure as code

## 📈 Monitoring & Observability

### CloudWatch Integration
- Lambda function logging
- API Gateway access logs
- DynamoDB metrics
- S3 access patterns

### Event Tracking
- EventBridge event correlation
- Tenant-specific event flows
- Processing pipeline visibility

## 🎯 Customization Points

### Data Types
- Extensible processing logic in `process/index.ts`
- Custom quality scoring algorithms
- Type-specific validation rules

### AI Models
- Configurable Bedrock model selection
- Custom prompt engineering
- Response parsing customization

### Infrastructure
- Configurable resource policies
- Environment-specific settings
- Custom IAM policies

## 🚨 Troubleshooting

### Common Issues
- CDK bootstrap requirements
- Lambda function build errors
- AWS permission issues
- Tenant isolation problems

### Debug Tools
- CDK diff for changes
- CloudWatch logs for runtime issues
- IAM policy simulator for permissions
- AWS Config for compliance

---

This structure provides a solid foundation for building and deploying multi-tenant AI-powered data processing platforms using AWS CDK.
