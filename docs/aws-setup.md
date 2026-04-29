# AWS one-time infrastructure setup

Manual provisioning for the production deploy. Replace `<account>`, `<region>`, `<subnets>`, `<sg>`, `<vercel-domain>` with real values.

> v1 design choice: **no Terraform/CDK**. The infra is small enough that hand-provisioning + this doc is faster than authoring + maintaining IaC. v2 path: convert this doc to a CDK stack.

## 1. ECR repository

```bash
aws ecr create-repository \
  --repository-name nex-books-back \
  --region <region> \
  --image-scanning-configuration scanOnPush=true
```

## 2. RDS Postgres (private subnets)

- Engine: PostgreSQL 16, `db.t4g.micro`, 20 GB gp3.
- VPC: default. **Private** subnets only — no public access.
- Security group `nex-rds-sg`: ingress 5432 from `nex-ecs-sg` only.
- DB name: `nex_books`. Master user: `nex`. Password: random 32-byte.

Save the connection string in Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name nex/prod/db \
  --secret-string '{"DATABASE_URL":"postgresql://nex:<pwd>@<endpoint>:5432/nex_books"}'
```

## 3. JWT secret

```bash
openssl rand -base64 48 | aws secretsmanager create-secret \
  --name nex/prod/jwt \
  --secret-string file:///dev/stdin
```

## 4. ECS cluster + task role

```bash
aws ecs create-cluster --cluster-name nex-cluster
```

IAM roles needed:
- `ecsTaskExecutionRole` (the standard one — pulls from ECR, writes to CloudWatch, reads secrets).
- `nex-books-task-role` (app role — empty for v1; add as needed).

Both already documented as managed policies; attach `AmazonECSTaskExecutionRolePolicy` and the inline secret-reads.

## 5. Task definitions

The repo ships two templates the workflow renders into real task definitions:
- `task-definitions/api.json` — long-running ECS service (port 4000).
- `task-definitions/migrate.json` — one-shot migration runner.

Both inject `DATABASE_URL` and `JWT_SECRET` from Secrets Manager via `secrets[]`. Logs land in `/ecs/nex-books-back`.

Register both once:

```bash
aws ecs register-task-definition --cli-input-json file://task-definitions/api.json
aws ecs register-task-definition --cli-input-json file://task-definitions/migrate.json
```

## 6. ALB + target group + ACM cert

- **ALB** `nex-alb`: public, 2 AZs, security group `nex-alb-sg` (80/443 from anywhere).
- **Target group** `nex-tg`: HTTP, port 4000, health check `GET /health` (200).
- **ACM cert** for `api.nex-books.<your-domain>` (or use the ALB DNS + Route 53).
- **HTTPS :443 listener** → target group. **HTTP :80 listener** → 301 redirect to HTTPS.

ECS security group `nex-ecs-sg` must allow ingress 4000 from `nex-alb-sg`.

## 7. ECS service

```bash
aws ecs create-service \
  --cluster nex-cluster \
  --service-name nex-books-api \
  --task-definition nex-books-back \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<subnets>],securityGroups=[<nex-ecs-sg>],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=<tg-arn>,containerName=api,containerPort=4000" \
  --health-check-grace-period-seconds 30 \
  --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200"
```

## 8. GitHub Actions OIDC role

Trust policy on `gh-actions-deploy`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:<org>/nex-books-reservation-back:ref:refs/heads/main" }
    }
  }]
}
```

Permissions:
- `AmazonEC2ContainerRegistryPowerUser` (push to ECR)
- Inline policy: `ecs:UpdateService`, `ecs:RegisterTaskDefinition`, `ecs:DescribeServices`, `ecs:DescribeTasks`, `ecs:RunTask`, `ecs:Wait*`, `iam:PassRole` on the task roles.

## 9. CloudWatch alarms (optional but cheap)

- 5xx > 1% over 5 minutes → SNS topic.
- Service CPU > 80% over 5 minutes → SNS topic.
- RDS connections > 80% of max → SNS topic.

## 10. CORS

Once the Vercel frontend is deployed, set the ECS task `CORS_ORIGIN` env to the Vercel URL (e.g. `https://nex-books-front.vercel.app,https://nex-books.<your-domain>`).
