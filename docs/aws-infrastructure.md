# AWS Infrastructure — Nex Books Reservation

Infraestructura creada el 2026-05-01 en la cuenta `150506369483`, región `us-east-1`.

---

## Recursos creados

### ECR — Container Registry
| Recurso | Valor |
|---|---|
| Repositorio | `nex-books-back` |
| URI | `150506369483.dkr.ecr.us-east-1.amazonaws.com/nex-books-back` |

### RDS — PostgreSQL 16
| Recurso | Valor |
|---|---|
| Identificador | `nex-books-db` |
| Endpoint | `nex-books-db.cc7g82gws5nk.us-east-1.rds.amazonaws.com` |
| Instancia | `db.t4g.micro` · 20 GB gp3 |
| Base de datos | `nex_books` · usuario `nex` |
| Acceso | Solo desde `nex-ecs-sg` (no público) |

### Secrets Manager
| Nombre | ARN | Contenido |
|---|---|---|
| `nex/prod/db` | `arn:aws:secretsmanager:us-east-1:150506369483:secret:nex/prod/db-9noSS8` | `{"DATABASE_URL":"postgresql://..."}` |
| `nex/prod/jwt` | `arn:aws:secretsmanager:us-east-1:150506369483:secret:nex/prod/jwt-LU1snk` | JWT secret (string plano, 48 bytes) |

### VPC y Redes
| Recurso | ID |
|---|---|
| VPC (default) | `vpc-0df96646da4519da0` |
| Subnets usadas | `subnet-0048544aeef6441b0` (us-east-1d) · `subnet-0cc84cdbbf9f2aed0` (us-east-1a) |

### Security Groups
| Nombre | ID | Reglas inbound |
|---|---|---|
| `nex-alb-sg` | `sg-0cbe4995fb50840f1` | 80/TCP 0.0.0.0/0 · 443/TCP 0.0.0.0/0 |
| `nex-ecs-sg` | `sg-03f936a068f584193` | 4000/TCP desde `nex-alb-sg` |
| `nex-rds-sg` | `sg-0bb3a59fd81029f18` | 5432/TCP desde `nex-ecs-sg` |

### ECS
| Recurso | Valor |
|---|---|
| Cluster | `nex-cluster` |
| Servicio | `nex-books-api` (desired: 1, Fargate) |
| Task definition API | `nex-books-back` (última revision activa) |
| Task definition migrate | `nex-books-back-migrate` |

### ALB — Application Load Balancer
| Recurso | Valor |
|---|---|
| Nombre | `nex-alb` |
| ARN | `arn:aws:elasticloadbalancing:us-east-1:150506369483:loadbalancer/app/nex-alb/d74c6fdc58a5430a` |
| DNS | `nex-alb-1393870835.us-east-1.elb.amazonaws.com` |
| Target group | `nex-tg` → port 4000 · health check `/health` |
| Listener | HTTP :80 → forward a `nex-tg` |

### CloudFront
| Recurso | Valor |
|---|---|
| Distribution ID | `E37DMDG2RQJAEU` |
| URL pública (HTTPS) | `https://d3uqn5vjvaiydr.cloudfront.net` |
| Origen | ALB HTTP:80 |
| TTL | 0 (pass-through, sin caché) |
| Headers forwarded | `Authorization`, `Content-Type`, `Origin` |

### IAM
| Recurso | Descripción |
|---|---|
| `ecsTaskExecutionRole` | Rol estándar ECS — pull ECR, CloudWatch logs, leer Secrets Manager |
| `nex-books-task-role` | Rol de la app (vacío en v1) |
| `gh-actions-deploy` | Rol OIDC para GitHub Actions — push ECR + deploy ECS |

### OIDC Provider
| Recurso | Valor |
|---|---|
| ARN | `arn:aws:iam::150506369483:oidc-provider/token.actions.githubusercontent.com` |
| Audience | `sts.amazonaws.com` |
| Scope | `repo:santiago2904/nex-books-reservation-back:ref:refs/heads/main` |

### CloudWatch
| Recurso | Valor |
|---|---|
| Log group API | `/ecs/nex-books-back` |

---

## URLs de producción

| Servicio | URL |
|---|---|
| **API GraphQL** | `https://d3uqn5vjvaiydr.cloudfront.net/graphql` |
| **API Health** | `https://d3uqn5vjvaiydr.cloudfront.net/health` |
| ALB (interno) | `http://nex-alb-1393870835.us-east-1.elb.amazonaws.com` |

---

## CI/CD — GitHub Actions

Push a `main` con cambios en `src/**`, `test/**`, `prisma/**`, `Dockerfile`, `package.json`, `task-definitions/**` dispara automáticamente:

1. Tests (unit + integration) contra Postgres efímero
2. Build imagen Docker `linux/amd64` → push a ECR (`:sha` + `:latest`)
3. Migraciones como one-off Fargate task
4. Update ECS service → wait-for-stability

Autenticación: OIDC (sin AWS keys en secretos de GitHub).

---

## Desprovisionamiento completo

Ejecutar en orden para eliminar **todos** los recursos y evitar costos.

> ⚠️ Esto es irreversible. Los datos de RDS se perderán permanentemente.

### 1. Eliminar CloudFront

```bash
# Primero deshabilitar
aws cloudfront update-distribution --id E37DMDG2RQJAEU \
  --if-match $(aws cloudfront get-distribution --id E37DMDG2RQJAEU --query 'ETag' --output text) \
  --distribution-config "$(aws cloudfront get-distribution-config --id E37DMDG2RQJAEU --query 'DistributionConfig' | python3 -c "import sys,json; d=json.load(sys.stdin); d['Enabled']=False; print(json.dumps(d))")"

# Esperar que se deshabilite (~5-10 min)
aws cloudfront wait distribution-deployed --id E37DMDG2RQJAEU

# Luego eliminar
aws cloudfront delete-distribution --id E37DMDG2RQJAEU \
  --if-match $(aws cloudfront get-distribution --id E37DMDG2RQJAEU --query 'ETag' --output text)
```

### 2. Eliminar ECS service y cluster

```bash
# Scale down a 0 antes de eliminar
aws ecs update-service --region us-east-1 --cluster nex-cluster --service nex-books-api --desired-count 0
aws ecs delete-service --region us-east-1 --cluster nex-cluster --service nex-books-api --force
aws ecs delete-cluster --region us-east-1 --cluster nex-cluster
```

### 3. Eliminar ALB, listener y target group

```bash
# Listener
aws elbv2 delete-listener --region us-east-1 \
  --listener-arn $(aws elbv2 describe-listeners --region us-east-1 --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:150506369483:loadbalancer/app/nex-alb/d74c6fdc58a5430a --query 'Listeners[0].ListenerArn' --output text)

# ALB
aws elbv2 delete-load-balancer --region us-east-1 \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:150506369483:loadbalancer/app/nex-alb/d74c6fdc58a5430a

# Target group
aws elbv2 delete-target-group --region us-east-1 \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:150506369483:targetgroup/nex-tg/5d36baff4cf527ab
```

### 4. Eliminar RDS

```bash
aws rds delete-db-instance --region us-east-1 \
  --db-instance-identifier nex-books-db \
  --skip-final-snapshot \
  --delete-automated-backups

# Esperar que se elimine (~5 min)
aws rds wait db-instance-deleted --region us-east-1 --db-instance-identifier nex-books-db

# Eliminar subnet group
aws rds delete-db-subnet-group --region us-east-1 --db-subnet-group-name nex-rds-subnet-group
```

### 5. Eliminar Secrets Manager

```bash
aws secretsmanager delete-secret --region us-east-1 --secret-id nex/prod/db --force-delete-without-recovery
aws secretsmanager delete-secret --region us-east-1 --secret-id nex/prod/jwt --force-delete-without-recovery
```

### 6. Eliminar ECR (imágenes + repositorio)

```bash
# Eliminar todas las imágenes
aws ecr batch-delete-image --region us-east-1 --repository-name nex-books-back \
  --image-ids "$(aws ecr list-images --region us-east-1 --repository-name nex-books-back --query 'imageIds' --output json)"

# Eliminar repositorio
aws ecr delete-repository --region us-east-1 --repository-name nex-books-back --force
```

### 7. Eliminar Security Groups

```bash
aws ec2 delete-security-group --region us-east-1 --group-id sg-0bb3a59fd81029f18  # RDS
aws ec2 delete-security-group --region us-east-1 --group-id sg-03f936a068f584193  # ECS
aws ec2 delete-security-group --region us-east-1 --group-id sg-0cbe4995fb50840f1  # ALB
```

### 8. Eliminar IAM roles y OIDC provider

```bash
# gh-actions-deploy
aws iam detach-role-policy --role-name gh-actions-deploy --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser
aws iam delete-role-policy --role-name gh-actions-deploy --policy-name ECSDeployPolicy
aws iam delete-role --role-name gh-actions-deploy

# ecsTaskExecutionRole
aws iam detach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam delete-role-policy --role-name ecsTaskExecutionRole --policy-name SecretManagerRead
aws iam delete-role --role-name ecsTaskExecutionRole

# nex-books-task-role
aws iam delete-role --role-name nex-books-task-role

# OIDC provider
aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::150506369483:oidc-provider/token.actions.githubusercontent.com
```

### 9. Eliminar task definitions (deregistrar)

```bash
for rev in 1 2; do
  aws ecs deregister-task-definition --region us-east-1 --task-definition nex-books-back:$rev
  aws ecs deregister-task-definition --region us-east-1 --task-definition nex-books-back-migrate:$rev
done
```

### 10. Eliminar CloudWatch log group

```bash
aws logs delete-log-group --region us-east-1 --log-group-name /ecs/nex-books-back
```

---

## Costo estimado en uso

| Servicio | Costo aprox/mes |
|---|---|
| RDS db.t4g.micro | ~$12 USD |
| ECS Fargate (1 task 0.25 vCPU / 0.5 GB) | ~$7 USD |
| ALB | ~$16 USD (mínimo) |
| CloudFront | ~$0 (free tier: 1TB/mes) |
| ECR | ~$0.10 USD (imágenes pequeñas) |
| Secrets Manager | ~$0.80 USD (2 secrets) |
| **Total** | **~$36 USD/mes** |

> El mayor costo es el ALB ($16/mes mínimo). Para proyectos personales/demos, considerar eliminar la infra cuando no se usa.
