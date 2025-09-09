# PayMeBro Backend - Frontend Integration Guide

## Base URL
```
Production: https://your-domain.com
Development: http://localhost:3000
Ngrok: https://e18fe8a5cac4.ngrok-free.app
```

## Authentication
All endpoints require Web3Auth user ID. No API keys needed for basic operations.

## Core Payment Flow

### 1. Create Payment
```javascript
POST /api/payments/create
{
  "amount": 0.01,
  "label": "Coffee Payment",
  "message": "Thanks for your purchase!",
  "web3AuthUserId": "user-uuid",
  "splToken": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" // Optional for USDC
}

Response:
{
  "success": true,
  "reference": "ABC123...",
  "url": "solana:recipient?amount=0.01&reference=ABC123...",
  "payment": { /* payment object */ }
}
```

### 2. Display Payment Page
```javascript
// Redirect user to payment page
window.location.href = `/payment/${reference}`;

// Or embed QR code directly
const qrUrl = `solana:${recipientAddress}?amount=${amount}&reference=${reference}`;
```

### 3. Real-time Status Updates
```javascript
// Connect to WebSocket
const socket = io('http://localhost:3000');

// Join payment room
socket.emit('join-payment', reference);

// Listen for updates
socket.on('payment-update', (data) => {
  if (data.status === 'confirmed') {
    showSuccessMessage();
  }
});
```

## Template System

### Create Template
```javascript
POST /api/templates
{
  "name": "Coffee Shop",
  "amount": 0.01,
  "currency": "SOL",
  "label": "☕ Coffee",
  "message": "Thanks!",
  "web3AuthUserId": "user-uuid"
}
```

### Get User Templates
```javascript
GET /api/templates/user/{web3AuthUserId}

Response:
{
  "success": true,
  "templates": [
    {
      "id": "template-uuid",
      "name": "Coffee Shop",
      "amount": 0.01,
      "currency": "SOL",
      "label": "☕ Coffee",
      "message": "Thanks!"
    }
  ]
}
```

### Create Payment from Template
```javascript
POST /api/templates/{templateId}/create-payment
{
  "customAmount": 0.02 // Optional override
}
```

## Analytics Dashboard

### Get Metrics
```javascript
GET /api/metrics

Response:
{
  "success": true,
  "metrics": {
    "totalPayments": 15,
    "confirmedPayments": 6,
    "pendingPayments": 9,
    "totalRevenue": 1.107,
    "conversionRate": "40.00",
    "currencyStats": {
      "SOL": 7,
      "USDC": 8
    }
  }
}
```

### Get Payment History
```javascript
GET /api/metrics/history?page=1&limit=10

Response:
{
  "success": true,
  "payments": [ /* payment objects */ ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "pages": 5
  }
}
```

## Error Handling
```javascript
// All endpoints return consistent error format
{
  "success": false,
  "error": "Error message"
}
```

## WebSocket Events
```javascript
// Payment status updates
socket.on('payment-update', (data) => {
  console.log('Payment update:', data);
  // data.status: 'pending' | 'confirmed' | 'failed'
  // data.reference: payment reference
  // data.signature: transaction signature (if confirmed)
});
```

## Frontend Integration Checklist

### Required Dependencies
```bash
npm install socket.io-client axios
```

### Environment Variables
```javascript
REACT_APP_API_URL=http://localhost:3000
REACT_APP_WS_URL=http://localhost:3000
```

### Key Components to Build
1. **PaymentCreator** - Form to create payments
2. **PaymentDisplay** - Show QR code and status
3. **TemplateManager** - CRUD operations for templates
4. **Dashboard** - Analytics and payment history
5. **WebSocketProvider** - Real-time updates context

### Sample React Hook
```javascript
// usePayment.js
import { useState, useEffect } from 'react';
import io from 'socket.io-client';

export const usePayment = (reference) => {
  const [status, setStatus] = useState('pending');
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const newSocket = io(process.env.REACT_APP_WS_URL);
    newSocket.emit('join-payment', reference);
    
    newSocket.on('payment-update', (data) => {
      setStatus(data.status);
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, [reference]);

  return { status, socket };
};
```

## Testing Endpoints
Use the provided ngrok URL for testing:
- Metrics: `curl https://e18fe8a5cac4.ngrok-free.app/api/metrics`
- Create payment: `curl -X POST https://e18fe8a5cac4.ngrok-free.app/api/payments/create`
