#!/bin/bash

# CortexAI CDK Deployment Script
# This script provides easy deployment options for different environments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="dev"
APPLICATION_NAME="cortex-ai"
ENABLE_AI_INSIGHTS="true"
REGION="us-east-1"
PROFILE=""

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV     Environment to deploy (dev|staging|prod) [default: dev]"
    echo "  -a, --app-name NAME       Application name [default: cortex-ai]"
    echo "  -r, --region REGION       AWS region [default: us-east-1]"
    echo "  -p, --profile PROFILE     AWS profile to use"
    echo "  --no-ai                   Disable AI insights (Bedrock integration)"
    echo "  -h, --help                Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Deploy to dev environment"
    echo "  $0 -e prod -a myapp                  # Deploy to prod with custom app name"
    echo "  $0 -e staging --no-ai                # Deploy to staging without AI insights"
    echo "  $0 -r eu-west-1 -p production       # Deploy to EU with production profile"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -a|--app-name)
            APPLICATION_NAME="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -p|--profile)
            PROFILE="$2"
            shift 2
            ;;
        --no-ai)
            ENABLE_AI_INSIGHTS="false"
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    print_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or prod."
    exit 1
fi

# Set AWS profile if specified
if [[ -n "$PROFILE" ]]; then
    export AWS_PROFILE="$PROFILE"
    print_status "Using AWS profile: $PROFILE"
fi

# Set AWS region
export AWS_DEFAULT_REGION="$REGION"
export CDK_DEFAULT_REGION="$REGION"

print_status "Deploying CortexAI to $ENVIRONMENT environment"
print_status "Application: $APPLICATION_NAME"
print_status "Region: $REGION"
print_status "AI Insights: $ENABLE_AI_INSIGHTS"

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    print_error "AWS CDK CLI is not installed. Please install it first:"
    echo "  npm install -g aws-cdk"
    exit 1
fi

# Check if we're in the right directory
if [[ ! -f "package.json" ]] || [[ ! -f "cdk.json" ]]; then
    print_error "This script must be run from the CortexAI project root directory"
    exit 1
fi

# Install dependencies
print_status "Installing dependencies..."
npm install

# Build Lambda functions
print_status "Building Lambda functions..."
cd lambda/upload && npm install && npm run build && cd ../..
cd lambda/process && npm install && npm run build && cd ../..
cd lambda/insights && npm install && npm run build && cd ../..

# Build CDK project
print_status "Building CDK project..."
npm run build

# Bootstrap CDK if needed
print_status "Checking CDK bootstrap status..."
if ! cdk list --context environment="$ENVIRONMENT" --context applicationName="$APPLICATION_NAME" --context enableAIInsights="$ENABLE_AI_INSIGHTS" &> /dev/null; then
    print_warning "CDK not bootstrapped in this account/region. Bootstrapping..."
    cdk bootstrap
fi

# Show deployment diff
print_status "Showing deployment diff..."
cdk diff --context environment="$ENVIRONMENT" --context applicationName="$APPLICATION_NAME" --context enableAIInsights="$ENABLE_AI_INSIGHTS"

# Ask for confirmation
echo ""
read -p "Do you want to proceed with the deployment? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_warning "Deployment cancelled by user"
    exit 0
fi

# Deploy the stack
print_status "Deploying CortexAI stack..."
cdk deploy --context environment="$ENVIRONMENT" --context applicationName="$APPLICATION_NAME" --context enableAIInsights="$ENABLE_AI_INSIGHTS" --require-approval never --outputs-file cdk-outputs.json

print_success "Deployment completed successfully!"
print_status "Stack outputs:"
cdk list --context environment="$ENVIRONMENT" --context applicationName="$APPLICATION_NAME" --context enableAIInsights="$ENABLE_AI_INSIGHTS"

# Generate frontend configuration
print_status "Generating frontend configuration..."
npm run postdeploy

echo ""
print_status "Next steps:"
echo "1. Set up Cognito users in the AWS Console"
echo "2. Configure your application with the API Gateway URL"
echo "3. Test the upload endpoint with sample data"
echo "4. Monitor CloudWatch logs for any issues"

if [[ "$ENABLE_AI_INSIGHTS" == "true" ]]; then
    echo "5. Ensure Amazon Bedrock is enabled in your AWS account"
    echo "6. Test AI insights generation with sample data"
fi
