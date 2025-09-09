# PayMeBro API Documentation

## Base URL
```
http://localhost:3000/api
```

## Authentication
- Most endpoints require `x-user-id` header with Web3Auth user ID
- Some endpoints use `authenticateUser` middleware for enhanced security

---

## 🔥 Payments API (`/api/payments`)

### Create Payment (BIP-39 Deterministic Addresses)
```http
POST /api/payments/create
Content-Type: application/json
x-user-id: <web3auth_user_id>

{
  "amount": 1.0,
  "label": "Coffee Purchase",
  "message": "Thank you!",
  "customerEmail": "customer@example.com",
  "web3AuthUserId": "<web3auth_user_id>",
  "chain": "solana",
  "splToken": "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
}
```

**New Features:**
- **Deterministic References**: Uses BIP-39 hierarchical deterministic addresses
- **User Tracking**: Each user gets unique payment counter and address sequence
- **Plan Enforcement**: Automatic payment limit checking (default: 100 payments)
- **Derivation Path**: `m/44'/501'/2024'/userId/0/paymentIndex`

**Response includes:**
```json
{
  "success": true,
  "reference": "DeterministicSolanaAddress...",
  "payment": {
    "counter": 5,
    "derivationPath": "m/44'/501'/2024'/user123/0/5"
  }
}
```

### Get Payment Details
```http
GET /api/payments/{reference}
```

### Get Payment Status
```http
GET /api/payments/{reference}/status
```

### Generate QR Code
```http
GET /api/payments/{reference}/qr
```

### Transaction Request (Solana Pay)
```http
GET /api/payments/{reference}/transaction-request
POST /api/payments/{reference}/transaction-request
Content-Type: application/json

{
  "account": "<wallet_public_key>"
}
```

### Send Invoice Email
```http
POST /api/payments/{reference}/invoice
```

### Manual Confirm Payment (Testing)
```http
POST /api/payments/{reference}/confirm
```

**Note**: This endpoint manually confirms a payment without requiring a transaction signature. Used for testing purposes only.

### Confirm Payment
```http
POST /api/payments/confirm
Content-Type: application/json

{
  "signature": "<transaction_signature>",
  "reference": "<payment_reference>"
}
```

**Automatic Payment Processing**: The system runs automatic payment monitoring every 15 seconds that:
- Checks all pending payments for on-chain confirmation
- Uses Solana Pay's `findReference` to detect transactions
- Validates transfer amounts and recipients
- Automatically updates payment status to "confirmed" when detected
- Sends webhooks, emails, and WebSocket notifications

Payments can also be manually confirmed via the endpoints above.

---

## 📊 Analytics API (`/api/analytics`) - Enhanced with User Tracking

### Get Basic Metrics (User-Specific)
```http
GET /api/analytics
x-user-id: <web3auth_user_id>
```

**Enhanced Response:**
```json
{
  "success": true,
  "analytics": {
    "totalPayments": 42,
    "paymentCounter": 42,
    "planUsage": {
      "current": 42,
      "limit": 100,
      "percentage": 42
    }
  }
}
```

### Get Payment History
```http
GET /api/analytics/history?page=1&limit=10
x-user-id: <web3auth_user_id>
```

### Get User's Deterministic Addresses
```http
GET /api/analytics/addresses?start=0&end=10
x-user-id: <web3auth_user_id>
```

**New Endpoint**: Returns user's deterministic address range for transaction history optimization.

**Response:**
```json
{
  "success": true,
  "addresses": [
    {
      "address": "SolanaAddress1...",
      "counter": 1,
      "derivationPath": "m/44'/501'/2024'/user123/0/1"
    }
  ],
  "count": 10
}
```

### Get Merchant Overview
```http
GET /api/analytics/overview
Authorization: Bearer <token>
```

### Get Payment Analytics
```http
GET /api/analytics/payment/{reference}
Authorization: Bearer <token>
```

### Get Trends
```http
GET /api/analytics/trends?period=7d
Authorization: Bearer <token>
```

---

## 👤 Users API (`/api/users`)

### Register User
```http
POST /api/users/register
Content-Type: application/json

{
  "web3AuthUserId": "<web3auth_user_id>",
  "email": "user@example.com",
  "solanaAddress": "<solana_wallet_address>",
  "ethereumAddress": "<ethereum_wallet_address>"
}
```

**New**: Automatically initializes user payment tracking with BIP-39 master seed.

### Get User Profile
```http
GET /api/users/profile/{web3AuthUserId}
GET /api/users/{userId}  # Alias
```

### Complete Onboarding
```http
POST /api/users/onboarding/complete
Content-Type: application/json

{
  "web3AuthUserId": "<web3auth_user_id>",
  "businessName": "My Business",
  "businessType": "retail",
  "walletAddress": "<solana_wallet_address>"
}
```

### Get Onboarding Status
```http
GET /api/users/onboarding/status/{web3AuthUserId}
```

---

## 🔄 Subscriptions API (`/api/subscriptions`)

### Create Subscription Plan
```http
POST /api/subscriptions/plans
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Premium Plan",
  "amount": "9.99",
  "currency": "USDC",
  "interval_type": "monthly",
  "interval_count": 1,
  "description": "Premium features"
}
```

### Get Merchant Plans
```http
GET /api/subscriptions/plans
Authorization: Bearer <token>
```

### Subscribe to Plan
```http
POST /api/subscriptions/subscribe
Content-Type: application/json

{
  "plan_id": "<plan_id>",
  "customer_email": "customer@example.com",
  "wallet_address": "<customer_wallet>"
}
```

### Get Subscription Analytics
```http
GET /api/subscriptions/analytics
Authorization: Bearer <token>
```

### Cancel Subscription
```http
DELETE /api/subscriptions/{subscriptionId}
```

### Process Renewals (Cron)
```http
POST /api/subscriptions/cron/daily
```

---

## 📋 Templates API (`/api/templates`)

### Create Template
```http
POST /api/templates
Content-Type: application/json

{
  "name": "Coffee Template",
  "amount": "5.00",
  "currency": "USDC",
  "label": "Coffee Purchase",
  "message": "Thanks for your order!",
  "web3AuthUserId": "<web3auth_user_id>"
}
```

### Get User Templates
```http
GET /api/templates/user/{web3AuthUserId}
```

### Update Template
```http
PUT /api/templates/{id}
Content-Type: application/json

{
  "name": "Updated Template",
  "amount": "10.00"
}
```

### Delete Template
```http
DELETE /api/templates/{id}
```

### Create Payment from Template
```http
POST /api/templates/{templateId}/create-payment
Content-Type: application/json

{
  "customerEmail": "customer@example.com"
}
```

---

## 🔗 Webhooks API (`/api/webhooks`)

### Register Webhook
```http
POST /api/webhooks
Content-Type: application/json

{
  "url": "https://your-app.com/webhook",
  "events": ["payment.confirmed", "subscription.created"],
  "web3AuthUserId": "<web3auth_user_id>"
}
```

---

## 📧 Emails API (`/api/emails`)

### Get Pending Emails
```http
GET /api/emails/pending
x-user-id: <web3auth_user_id>
```

### Process Email Queue
```http
POST /api/emails/process
```

### Send Test Email
```http
POST /api/emails/test
Content-Type: application/json

{
  "email": "test@example.com",
  "userId": "<web3auth_user_id>"
}
```

---

## 🔐 BIP-39 Deterministic Address System

### Key Features
- **Hierarchical Deterministic**: Uses BIP-39 standard for address generation
- **User Isolation**: Each user has unique address space
- **Plan Enforcement**: Automatic payment limit checking
- **Performance**: 10-100x faster transaction history retrieval
- **Security**: Encrypted master seed storage

### Derivation Path Structure
```
m/44'/501'/2024'/userId/0/paymentIndex
```
- `44'`: BIP-44 standard
- `501'`: Solana coin type
- `2024'`: PayMeBro app identifier
- `userId`: User isolation
- `paymentIndex`: Sequential payment counter

### Plan Limits
- **Free Tier**: 10 payments/month
- **Pro Tier**: 100 payments/month
- **Enterprise**: Unlimited

### Database Schema
```sql
user_payment_tracking {
  web3auth_user_id: string (unique),
  payment_counter: integer,
  master_seed_hash: text (encrypted),
  total_payments: integer,
  created_at: timestamp,
  updated_at: timestamp
}

payments {
  -- existing fields --
  payment_counter: integer,
  derivation_path: string
}
```

---

## Response Formats

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Payment Response (Enhanced)
```json
{
  "success": true,
  "reference": "DeterministicSolanaAddress123...",
  "url": "solana:http://localhost:3000/api/payments/ref/transaction-request",
  "paymentUrl": "http://localhost:3000/payment/DeterministicSolanaAddress123...",
  "qrCode": "data:image/png;base64,...",
  "payment": {
    "id": "uuid",
    "amount": 5.0,
    "currency": "USDC",
    "status": "pending",
    "counter": 5,
    "derivationPath": "m/44'/501'/2024'/user123/0/5"
  }
}
```

---

## Rate Limits
- Payment creation: 10 requests/minute
- Payment confirmation: 20 requests/minute  
- Authentication: 5 requests/minute
- General: 100 requests/minute

## Supported Tokens
- **SOL**: Native Solana token
- **USDC**: `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` (Devnet)

## WebSocket Events
Connect to `/` for real-time updates:
- `payment-update`: Payment status changes
- `subscription-update`: Subscription events
