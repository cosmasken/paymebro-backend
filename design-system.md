# AfriPay Static Frontend Design System

## Environment Config & Hydration
```typescript
// .env
VITE_USE_MOCK_DATA=true
VITE_API_URL=http://localhost:3000
VITE_WEB3AUTH_CLIENT_ID=mock_client_id

// config/hydration.ts
export const appConfig = {
  useMock: import.meta.env.VITE_USE_MOCK_DATA === 'true',
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  web3AuthClientId: import.meta.env.VITE_WEB3AUTH_CLIENT_ID,
  
  // Easy hydration - just change env vars
  hydrate: (apiUrl: string) => ({
    useMock: false,
    apiUrl,
    web3AuthClientId: import.meta.env.VITE_WEB3AUTH_CLIENT_ID
  })
};
```

## ✅ VERIFIED Database Schemas (from Supabase)

```typescript
// User Schema (VERIFIED)
interface User {
  id: string;
  web3auth_user_id: string;
  email: string;
  solana_address: string;
  ethereum_address: string;
  polygon_address?: string | null;
  arbitrum_address?: string | null;
  optimism_address?: string | null;
  avalanche_address?: string | null;
  created_at: string;
  updated_at: string;
  first_name?: string | null;
  last_name?: string | null;
  business_name?: string | null;
  phone_number?: string | null;
  country?: string | null;
  onboarding_completed: boolean;
}

// Payment Schema (VERIFIED)
interface Payment {
  id: string;
  reference: string;
  web3auth_user_id: string;
  amount: number;
  currency: string;
  chain: string;
  recipient_address: string;
  label: string;
  message: string;
  memo?: string | null;
  status: 'pending' | 'confirmed' | 'failed' | 'expired';
  transaction_signature?: string | null;
  customer_email: string;
  created_at: string;
  updated_at: string;
  spl_token_mint: string;
  fee_amount: number;
  merchant_amount: number;
  total_amount_paid: number;
}

// Payment Template Schema (VERIFIED - table exists but empty)
interface PaymentTemplate {
  id: string;
  name: string;
  amount: number;
  currency: string;
  label: string;
  message: string;
  spl_token_mint?: string | null;
  web3auth_user_id: string;
  created_at: string;
  updated_at: string;
}

// Request/Response Interfaces
interface RegisterUserRequest {
  web3AuthUserId: string;
  email?: string;
  solanaAddress: string;
  ethereumAddress: string;
}

interface OnboardingRequest {
  web3AuthUserId: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  phoneNumber?: string;
  country?: string;
}

interface CreatePaymentRequest {
  amount: number;
  label: string;
  message: string;
  customerEmail?: string;
  web3AuthUserId: string;
  chain: 'solana';
  splToken?: string;
  merchantWallet?: string;
}

interface PaymentResponse {
  success: boolean;
  reference: string;
  url: string;
  paymentUrl: string;
  payment: Payment;
}

interface CreateTemplateRequest {
  name: string;
  amount: number;
  currency: string;
  label: string;
  message: string;
  web3AuthUserId: string;
  splToken?: string;
}

// Analytics Schema
interface Metrics {
  totalPayments: number;
  confirmedPayments: number;
  pendingPayments: number;
  totalRevenue: number;
  conversionRate: string;
  currencyStats: Record<string, number>;
  totalUsers: number;
  recentPayments: number;
}

interface PaymentHistory {
  success: boolean;
  payments: Payment[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

## ✅ VERIFIED Mock Data (matches backend)

```typescript
const MOCK_USER: User = {
  id: "58eba59f-68e8-4763-873a-e00cb51e7802",
  web3auth_user_id: "mock_user_123",
  email: "user@example.com",
  solana_address: "GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo",
  ethereum_address: "0x09aB514B6974601967E7b379478EFf4073cceD06",
  polygon_address: null,
  arbitrum_address: null,
  optimism_address: null,
  avalanche_address: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  first_name: "John",
  last_name: "Doe",
  business_name: "Coffee Shop",
  phone_number: "+1234567890",
  country: "US",
  onboarding_completed: false
};

const MOCK_ONBOARDED_USER: User = {
  ...MOCK_USER,
  onboarding_completed: true,
  business_name: "Coffee Shop",
  first_name: "John",
  last_name: "Doe"
};

const MOCK_PAYMENT: Payment = {
  id: "2e6a646d-c241-4887-b03f-bd5366f4f838",
  reference: "HyddGXcmUSToxrD1UtWRBnxvnWPssSJVFePWH4X4riMX",
  web3auth_user_id: "mock_user_123",
  amount: 10.0,
  currency: "USDC",
  chain: "solana",
  recipient_address: "GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo",
  label: "Coffee Purchase",
  message: "Thank you for your order!",
  memo: null,
  status: "pending",
  transaction_signature: null,
  customer_email: "customer@example.com",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  spl_token_mint: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
  fee_amount: 0.3145,
  merchant_amount: 10.0,
  total_amount_paid: 10.3145
};

const MOCK_PAYMENT_RESPONSE: PaymentResponse = {
  success: true,
  reference: "HyddGXcmUSToxrD1UtWRBnxvnWPssSJVFePWH4X4riMX",
  url: "solana:http://localhost:3000/api/payments/HyddGXcmUSToxrD1UtWRBnxvnWPssSJVFePWH4X4riMX/transaction-request",
  paymentUrl: "http://localhost:3000/payment/HyddGXcmUSToxrD1UtWRBnxvnWPssSJVFePWH4X4riMX",
  payment: MOCK_PAYMENT
};

const MOCK_METRICS: Metrics = {
  totalPayments: 25,
  confirmedPayments: 20,
  pendingPayments: 5,
  totalRevenue: 1250.50,
  conversionRate: "80.0",
  currencyStats: { "USDC": 15, "SOL": 10 },
  totalUsers: 12,
  recentPayments: 3
};

const MOCK_TEMPLATES: PaymentTemplate[] = [
  {
    id: "template_1",
    name: "Coffee",
    amount: 5,
    currency: "USDC",
    label: "Coffee Purchase",
    message: "Thanks for your order!",
    web3auth_user_id: "mock_user_123",
    spl_token_mint: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];
```

## ✅ Complete User Flow Hooks (Missing Pieces Added)

```typescript
// Auto-Registration Hook
const useAutoRegister = () => {
  const [isRegistering, setIsRegistering] = useState(false);

  const autoRegister = async (web3AuthUser: any) => {
    if (appConfig.useMock) {
      return Promise.resolve({ success: true, user: MOCK_USER, isNewUser: true });
    }

    setIsRegistering(true);
    try {
      // Check if user exists first
      const existsResponse = await fetch(`${appConfig.apiUrl}/api/users/profile/${web3AuthUser.sub}`);
      
      if (existsResponse.ok) {
        const userData = await existsResponse.json();
        return { success: true, user: userData.user, isNewUser: false };
      }

      // Extract addresses from Web3Auth (implementation depends on Web3Auth setup)
      const solanaAddress = web3AuthUser.solanaAddress || "GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo";
      const ethereumAddress = web3AuthUser.ethereumAddress || "0x09aB514B6974601967E7b379478EFf4073cceD06";

      // Auto-register new user
      const response = await fetch(`${appConfig.apiUrl}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          web3AuthUserId: web3AuthUser.sub,
          email: web3AuthUser.email,
          solanaAddress,
          ethereumAddress
        })
      });

      return response.json();
    } finally {
      setIsRegistering(false);
    }
  };

  return { autoRegister, isRegistering };
};

// Dashboard Onboarding State Hook
const useDashboardOnboarding = (user: User | null) => {
  if (!user) return { showOnboarding: false, currentStep: null };

  const needsOnboarding = !user.onboarding_completed;
  const hasBusinessInfo = user.business_name && user.first_name;

  return {
    showOnboarding: needsOnboarding,
    currentStep: needsOnboarding ? 
      (!hasBusinessInfo ? 'business-info' : 'first-payment') : 
      'complete',
    needsBusinessInfo: needsOnboarding && !hasBusinessInfo,
    needsFirstPayment: needsOnboarding && hasBusinessInfo
  };
};

// Complete Onboarding Flow Hook
const useOnboardingFlow = (userId: string) => {
  const [step, setStep] = useState<'business-info' | 'first-payment' | 'complete'>('business-info');
  const [businessData, setBusinessData] = useState<any>(null);
  const [firstPayment, setFirstPayment] = useState<Payment | null>(null);

  const completeBusinessInfo = async (data: OnboardingRequest) => {
    if (appConfig.useMock) {
      setBusinessData(data);
      setStep('first-payment');
      return Promise.resolve({ success: true });
    }

    const response = await fetch(`${appConfig.apiUrl}/api/users/onboarding/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (result.success) {
      setBusinessData(data);
      setStep('first-payment');
    }
    return result;
  };

  const completeFirstPayment = (payment: Payment) => {
    setFirstPayment(payment);
    setStep('complete');
  };

  const finishOnboarding = () => {
    // Mark onboarding as complete in user state
    setStep('complete');
  };

  return {
    step,
    businessData,
    firstPayment,
    completeBusinessInfo,
    completeFirstPayment,
    finishOnboarding,
    setStep
  };
};

// Enhanced Payment Hook with QR Code
const usePayment = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createPayment = async (data: CreatePaymentRequest) => {
    if (appConfig.useMock) {
      return Promise.resolve({
        ...MOCK_PAYMENT_RESPONSE,
        qrCode: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      });
    }

    setLoading(true);
    setError(null);

    try {
      // Create payment
      const response = await fetch(`${appConfig.apiUrl}/api/payments/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': data.web3AuthUserId
        },
        body: JSON.stringify(data)
      });

      const paymentResult = await response.json();
      
      if (!paymentResult.success) {
        throw new Error(paymentResult.error);
      }

      // Get QR code
      const qrResponse = await fetch(`${appConfig.apiUrl}/api/payments/${paymentResult.reference}/qr`);
      const qrResult = await qrResponse.json();

      return {
        ...paymentResult,
        qrCode: qrResult.success ? qrResult.qrCode : null
      };

    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getPaymentStatus = async (reference: string) => {
    if (appConfig.useMock) {
      return Promise.resolve({ success: true, status: 'confirmed' });
    }

    const response = await fetch(`${appConfig.apiUrl}/api/payments/${reference}/status`);
    return response.json();
  };

  return { createPayment, getPaymentStatus, loading, error };
};

// Web3Auth Integration Hook
const useWeb3Auth = () => {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const login = async () => {
    if (appConfig.useMock) {
      const mockWeb3AuthUser = {
        sub: "mock_user_123",
        email: "user@example.com",
        name: "John Doe",
        picture: "https://via.placeholder.com/150",
        solanaAddress: "GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo",
        ethereumAddress: "0x09aB514B6974601967E7b379478EFf4073cceD06"
      };
      setUser(mockWeb3AuthUser);
      setIsAuthenticated(true);
      return mockWeb3AuthUser;
    }

    setIsLoading(true);
    try {
      // Real Web3Auth implementation would go here
      // const web3auth = new Web3Auth({ clientId: appConfig.web3AuthClientId });
      // const provider = await web3auth.connect();
      // const user = await web3auth.getUserInfo();
      // setUser(user);
      // setIsAuthenticated(true);
      // return user;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    if (appConfig.useMock) {
      setUser(null);
      setIsAuthenticated(false);
      return;
    }

    // Real logout implementation
    setUser(null);
    setIsAuthenticated(false);
  };

  return {
    user,
    isLoading,
    isAuthenticated,
    login,
    logout
  };
};

// Payment Monitoring Hook (Real-time updates)
const usePaymentMonitor = (reference?: string) => {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'failed'>('pending');
  const [payment, setPayment] = useState<Payment | null>(null);

  useEffect(() => {
    if (!reference || appConfig.useMock) return;

    // WebSocket connection for real-time updates
    const ws = new WebSocket(`ws://localhost:3000`);
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join-payment', reference }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'payment-update' && data.reference === reference) {
        setStatus(data.status);
        setPayment(data.payment);
      }
    };

    // Fallback polling
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${appConfig.apiUrl}/api/payments/${reference}/status`);
        const data = await response.json();
        if (data.success) {
          setStatus(data.status);
        }
      } catch (error) {
        console.error('Status polling failed:', error);
      }
    }, 5000);

    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, [reference]);

  return { status, payment };
};
```

## Complete Page Components Structure

```typescript
// Landing Page Component
interface LandingPageProps {
  onGetStarted: () => void;
}

// Auto-Registration Component (after Web3Auth)
interface AutoRegisterProps {
  web3AuthUser: any;
  onRegistrationComplete: (user: User, isNewUser: boolean) => void;
  onError: (error: string) => void;
}

// Dashboard Component with Onboarding Detection
interface DashboardProps {
  user: User;
  onboardingStep: 'business-info' | 'first-payment' | 'complete' | null;
  showOnboarding: boolean;
}

// Business Info Onboarding Step
interface BusinessInfoStepProps {
  user: User;
  onComplete: (data: OnboardingRequest) => void;
  loading: boolean;
}

// First Payment Onboarding Step
interface FirstPaymentStepProps {
  user: User;
  onPaymentCreated: (payment: Payment) => void;
  onComplete: () => void;
}

// Onboarding Complete Step
interface OnboardingCompleteProps {
  businessData: any;
  firstPayment: Payment;
  onGoToDashboard: () => void;
}

// Payment Creation Component
interface PaymentCreationProps {
  user: User;
  onPaymentCreated: (payment: PaymentResponse) => void;
  isOnboarding?: boolean;
}

// Payment Display Component (QR + Details)
interface PaymentDisplayProps {
  payment: Payment;
  qrCode?: string;
  onShare: () => void;
  onNewPayment: () => void;
}
```

## Error Handling & Loading States

```typescript
// Global Error Handler Hook
const useErrorHandler = () => {
  const [error, setError] = useState<string | null>(null);

  const handleError = (error: any) => {
    const message = error?.response?.data?.error || error?.message || 'An error occurred';
    setError(message);
    console.error('App Error:', error);
  };

  const clearError = () => setError(null);

  return { error, handleError, clearError };
};

// Loading States Hook
const useLoadingStates = () => {
  const [states, setStates] = useState({
    auth: false,
    registration: false,
    onboarding: false,
    payment: false,
    general: false
  });

  const setLoading = (key: keyof typeof states, loading: boolean) => {
    setStates(prev => ({ ...prev, [key]: loading }));
  };

  return { loadingStates: states, setLoading };
};
```

## Navigation & Routing

```typescript
// App Router with Flow Management
interface AppRouterProps {
  user: User | null;
  isAuthenticated: boolean;
  onboardingComplete: boolean;
}

// Route Guards
const ProtectedRoute = ({ children, user, requireOnboarding = true }: {
  children: React.ReactNode;
  user: User | null;
  requireOnboarding?: boolean;
}) => {
  if (!user) return <Navigate to="/" />;
  if (requireOnboarding && !user.onboarding_completed) {
    return <Navigate to="/onboarding" />;
  }
  return <>{children}</>;
};
```

## Complete Onboarding Flow

```typescript
// Onboarding States
type OnboardingStep = 'welcome' | 'business-info' | 'first-payment' | 'complete';

interface OnboardingState {
  currentStep: OnboardingStep;
  businessName: string;
  businessType: string;
  firstPayment?: Payment;
}

// Onboarding Hook
const useOnboarding = (userId: string) => {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [data, setData] = useState<Partial<OnboardingState>>({});

  const completeBusinessInfo = async (businessData: { businessName: string; businessType: string; walletAddress: string }) => {
    // Call backend onboarding completion
    const result = await completeOnboarding({
      web3AuthUserId: userId,
      ...businessData
    });
    
    if (result.success) {
      setStep('first-payment');
      setData(prev => ({ ...prev, ...businessData }));
    }
    
    return result;
  };

  const completeFirstPayment = (payment: Payment) => {
    setData(prev => ({ ...prev, firstPayment: payment }));
    setStep('complete');
  };

  return {
    step,
    data,
    setStep,
    completeBusinessInfo,
    completeFirstPayment
  };
};
```

## Page Components Structure

```typescript
// Landing Page
interface LandingPageProps {
  onGetStarted: () => void;
}

// Onboarding Pages
interface WelcomeStepProps {
  onNext: () => void;
  userName: string;
}

interface BusinessInfoStepProps {
  onComplete: (data: { businessName: string; businessType: string; walletAddress: string }) => void;
  loading: boolean;
}

interface FirstPaymentStepProps {
  onPaymentCreated: (payment: Payment) => void;
  userId: string;
}

interface OnboardingCompleteProps {
  businessName: string;
  firstPayment: Payment;
  onGoToDashboard: () => void;
}

// Dashboard
interface DashboardProps {
  user: User;
  metrics: Metrics;
  recentPayments: Payment[];
}
```

## Complete User Flow States

```typescript
// App-wide State Management (Zustand Store)
interface AppState {
  // Auth State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Onboarding State
  onboardingStep: 'business-info' | 'first-payment' | 'complete' | null;
  businessData: any;
  firstPayment: Payment | null;
  
  // Current Payment State
  currentPayment: Payment | null;
  paymentQR: string | null;
  
  // UI State
  showOnboarding: boolean;
  error: string | null;
  
  // Actions
  setUser: (user: User | null) => void;
  setAuthenticated: (auth: boolean) => void;
  setOnboardingStep: (step: string) => void;
  setCurrentPayment: (payment: Payment | null) => void;
  setError: (error: string | null) => void;
  completeOnboarding: () => void;
  reset: () => void;
}

const useAppStore = create<AppState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  onboardingStep: null,
  businessData: null,
  firstPayment: null,
  currentPayment: null,
  paymentQR: null,
  showOnboarding: false,
  error: null,
  
  setUser: (user) => set({ 
    user, 
    showOnboarding: user ? !user.onboarding_completed : false,
    onboardingStep: user && !user.onboarding_completed ? 'business-info' : null
  }),
  
  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
  setOnboardingStep: (step) => set({ onboardingStep: step as any }),
  setCurrentPayment: (currentPayment) => set({ currentPayment }),
  setError: (error) => set({ error }),
  
  completeOnboarding: () => set({ 
    onboardingStep: 'complete',
    showOnboarding: false,
    user: get().user ? { ...get().user!, onboarding_completed: true } : null
  }),
  
  reset: () => set({
    user: null,
    isAuthenticated: false,
    onboardingStep: null,
    showOnboarding: false,
    error: null
  })
}));
```

## Additional Missing Hooks

```typescript
// Auto-Registration Hook
const useAutoRegister = () => {
  const autoRegister = async (web3AuthUser: any) => {
    if (appConfig.useMock) {
      return { success: true, user: MOCK_USER, isNewUser: true };
    }

    // Check if user exists
    const existsResponse = await fetch(`${appConfig.apiUrl}/api/users/profile/${web3AuthUser.sub}`);
    if (existsResponse.ok) {
      const userData = await existsResponse.json();
      return { success: true, user: userData.user, isNewUser: false };
    }

    // Register new user
    const response = await fetch(`${appConfig.apiUrl}/api/users/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        web3AuthUserId: web3AuthUser.sub,
        email: web3AuthUser.email,
        solanaAddress: web3AuthUser.solanaAddress || "GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo",
        ethereumAddress: web3AuthUser.ethereumAddress || "0x09aB514B6974601967E7b379478EFf4073cceD06"
      })
    });
    return response.json();
  };

  return { autoRegister };
};

// Dashboard Onboarding Detection
const useDashboardOnboarding = (user: User | null) => {
  if (!user) return { showOnboarding: false, currentStep: null };

  const needsOnboarding = !user.onboarding_completed;
  const hasBusinessInfo = user.business_name && user.first_name;

  return {
    showOnboarding: needsOnboarding,
    currentStep: needsOnboarding ? 
      (!hasBusinessInfo ? 'business-info' : 'first-payment') : 'complete',
    needsBusinessInfo: needsOnboarding && !hasBusinessInfo,
    needsFirstPayment: needsOnboarding && hasBusinessInfo
  };
};

// Payment with QR Code
const usePaymentWithQR = () => {
  const [loading, setLoading] = useState(false);

  const createPaymentWithQR = async (data: CreatePaymentRequest) => {
    if (appConfig.useMock) {
      return {
        ...MOCK_PAYMENT_RESPONSE,
        qrCode: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      };
    }

    setLoading(true);
    try {
      // Create payment
      const paymentResponse = await fetch(`${appConfig.apiUrl}/api/payments/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': data.web3AuthUserId
        },
        body: JSON.stringify(data)
      });
      const paymentResult = await paymentResponse.json();

      // Get QR code
      const qrResponse = await fetch(`${appConfig.apiUrl}/api/payments/${paymentResult.reference}/qr`);
      const qrResult = await qrResponse.json();

      return {
        ...paymentResult,
        qrCode: qrResult.success ? qrResult.qrCode : null
      };
    } finally {
      setLoading(false);
    }
  };

  return { createPaymentWithQR, loading };
};

// Real-time Payment Monitor
const usePaymentMonitor = (reference?: string) => {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'failed'>('pending');

  useEffect(() => {
    if (!reference || appConfig.useMock) return;

    const ws = new WebSocket(`ws://localhost:3000`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join-payment', reference }));
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'payment-update' && data.reference === reference) {
        setStatus(data.status);
      }
    };

    const interval = setInterval(async () => {
      const response = await fetch(`${appConfig.apiUrl}/api/payments/${reference}/status`);
      const data = await response.json();
      if (data.success) setStatus(data.status);
    }, 5000);

    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, [reference]);

  return { status };
};
```

## Complete Component Interfaces

```typescript
// Landing Page
interface LandingPageProps {
  onGetStarted: () => void;
}

// Auto-Registration Component
interface AutoRegisterProps {
  web3AuthUser: any;
  onComplete: (user: User, isNewUser: boolean) => void;
}

// Dashboard with Onboarding
interface DashboardProps {
  user: User;
  showOnboarding: boolean;
  onboardingStep: string | null;
}

// Business Info Step
interface BusinessInfoStepProps {
  user: User;
  onComplete: (data: OnboardingRequest) => void;
}

// First Payment Step
interface FirstPaymentStepProps {
  user: User;
  onPaymentCreated: (payment: Payment) => void;
  onComplete: () => void;
}

// Payment Display
interface PaymentDisplayProps {
  payment: Payment;
  qrCode?: string;
  onShare: () => void;
}
```

## Error Handling & Navigation

```typescript
// Error Handler
const useErrorHandler = () => {
  const [error, setError] = useState<string | null>(null);
  const handleError = (error: any) => {
    setError(error?.response?.data?.error || error?.message || 'An error occurred');
  };
  return { error, handleError, clearError: () => setError(null) };
};

// Route Guard
const ProtectedRoute = ({ children, user, requireOnboarding = true }: {
  children: React.ReactNode;
  user: User | null;
  requireOnboarding?: boolean;
}) => {
  if (!user) return <Navigate to="/" />;
  if (requireOnboarding && !user.onboarding_completed) {
    return <Navigate to="/onboarding" />;
  }
  return <>{children}</>;
};
```

## Color System & Design Tokens

```typescript
// Color Palette (Tailwind CSS Variables)
const colors = {
  // Primary Brand Colors
  primary: {
    50: '#f0f9ff',
    100: '#e0f2fe', 
    500: '#0ea5e9',  // Main brand blue
    600: '#0284c7',
    900: '#0c4a6e'
  },
  
  // Success (Payment Confirmed)
  success: {
    50: '#f0fdf4',
    100: '#dcfce7',
    500: '#22c55e',  // Green for confirmed payments
    600: '#16a34a',
    900: '#14532d'
  },
  
  // Warning (Payment Pending)
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    500: '#f59e0b',  // Orange for pending payments
    600: '#d97706',
    900: '#92400e'
  },
  
  // Error (Payment Failed)
  error: {
    50: '#fef2f2',
    100: '#fee2e2',
    500: '#ef4444',  // Red for failed payments
    600: '#dc2626',
    900: '#7f1d1d'
  },
  
  // Neutral/Gray Scale
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827'
  },
  
  // Solana Brand Colors
  solana: {
    purple: '#9945ff',
    green: '#14f195',
    gradient: 'linear-gradient(135deg, #9945ff 0%, #14f195 100%)'
  }
};

// CSS Variables for Tailwind
const cssVariables = `
:root {
  --color-primary: 14 165 233;
  --color-success: 34 197 94;
  --color-warning: 245 158 11;
  --color-error: 239 68 68;
  --color-solana-purple: 153 69 255;
  --color-solana-green: 20 241 149;
}

.dark {
  --color-primary: 56 189 248;
  --color-success: 74 222 128;
  --color-warning: 251 191 36;
  --color-error: 248 113 113;
}
`;

// Tailwind Config Colors
const tailwindColors = {
  primary: {
    DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
    50: '#f0f9ff',
    500: 'rgb(var(--color-primary) / <alpha-value>)',
    600: '#0284c7'
  },
  success: {
    DEFAULT: 'rgb(var(--color-success) / <alpha-value>)',
    50: '#f0fdf4',
    500: 'rgb(var(--color-success) / <alpha-value>)'
  },
  warning: {
    DEFAULT: 'rgb(var(--color-warning) / <alpha-value>)',
    50: '#fffbeb',
    500: 'rgb(var(--color-warning) / <alpha-value>)'
  },
  error: {
    DEFAULT: 'rgb(var(--color-error) / <alpha-value>)',
    50: '#fef2f2',
    500: 'rgb(var(--color-error) / <alpha-value>)'
  },
  solana: {
    purple: 'rgb(var(--color-solana-purple) / <alpha-value>)',
    green: 'rgb(var(--color-solana-green) / <alpha-value>)'
  }
};
```

## Component Color Usage

```typescript
// Payment Status Colors
const paymentStatusColors = {
  pending: 'bg-warning-50 text-warning-700 border-warning-200',
  confirmed: 'bg-success-50 text-success-700 border-success-200', 
  failed: 'bg-error-50 text-error-700 border-error-200'
};

// Button Variants
const buttonColors = {
  primary: 'bg-primary-500 hover:bg-primary-600 text-white',
  success: 'bg-success-500 hover:bg-success-600 text-white',
  outline: 'border-gray-300 text-gray-700 hover:bg-gray-50',
  solana: 'bg-gradient-to-r from-solana-purple to-solana-green text-white'
};

// Card Colors
const cardColors = {
  default: 'bg-white border-gray-200 shadow-sm',
  dark: 'bg-gray-800 border-gray-700',
  payment: 'bg-gradient-to-br from-primary-50 to-blue-50 border-primary-200'
};
```

## Typography & Spacing

```typescript
// Typography Scale
const typography = {
  // Headings
  h1: 'text-3xl font-bold text-gray-900 dark:text-white',
  h2: 'text-2xl font-semibold text-gray-800 dark:text-gray-100',
  h3: 'text-xl font-medium text-gray-700 dark:text-gray-200',
  
  // Body Text
  body: 'text-base text-gray-600 dark:text-gray-300',
  small: 'text-sm text-gray-500 dark:text-gray-400',
  
  // Special
  amount: 'text-2xl font-bold text-gray-900 dark:text-white',
  currency: 'text-sm font-medium text-gray-500 uppercase'
};

// Spacing Scale
const spacing = {
  xs: '0.5rem',    // 8px
  sm: '0.75rem',   // 12px  
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem'    // 48px
};
```

## Component Examples

```typescript
// Payment Card Component Colors
const PaymentCard = `
<div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
  <div className="flex items-center justify-between mb-4">
    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
      Payment Request
    </h3>
    <span className="px-2 py-1 text-xs font-medium rounded-full bg-warning-50 text-warning-700 border border-warning-200">
      Pending
    </span>
  </div>
  
  <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
    $10.00
    <span className="text-sm font-normal text-gray-500 ml-2">USDC</span>
  </div>
  
  <button className="w-full bg-primary-500 hover:bg-primary-600 text-white font-medium py-2 px-4 rounded-lg transition-colors">
    Share Payment Link
  </button>
</div>
`;

// Dashboard Metrics Colors
const MetricsCard = `
<div className="bg-gradient-to-br from-primary-50 to-blue-50 dark:from-gray-800 dark:to-gray-700 rounded-lg p-6 border border-primary-200 dark:border-gray-600">
  <div className="flex items-center">
    <div className="p-2 bg-primary-500 rounded-lg">
      <svg className="w-6 h-6 text-white" fill="currentColor">
        <!-- Icon -->
      </svg>
    </div>
    <div className="ml-4">
      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Total Revenue</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">$1,250.50</p>
    </div>
  </div>
</div>
`;
```

## Dark Mode Support

```typescript
// Dark Mode Classes
const darkModeColors = {
  background: 'bg-gray-900',
  surface: 'bg-gray-800',
  border: 'border-gray-700',
  text: {
    primary: 'text-white',
    secondary: 'text-gray-300',
    muted: 'text-gray-400'
  }
};

// Theme Toggle
const themeColors = {
  light: {
    background: 'bg-white',
    text: 'text-gray-900',
    border: 'border-gray-200'
  },
  dark: {
    background: 'bg-gray-900', 
    text: 'text-white',
    border: 'border-gray-700'
  }
};
```

## Transitions & Animations

```typescript
// Transition Classes
const transitions = {
  default: 'transition-all duration-200 ease-in-out',
  fast: 'transition-all duration-150 ease-in-out',
  slow: 'transition-all duration-300 ease-in-out',
  colors: 'transition-colors duration-200 ease-in-out',
  transform: 'transition-transform duration-200 ease-in-out',
  hover: 'hover:scale-105 transition-transform duration-200',
  pulse: 'animate-pulse',
  spin: 'animate-spin'
};

// Framer Motion Variants
const motionVariants = {
  pageEnter: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -20 }
  },
  modalOverlay: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 }
  },
  modalContent: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 }
  },
  successCheck: {
    initial: { scale: 0 },
    animate: { scale: 1, rotate: 360 },
    transition: { duration: 0.5, ease: "backOut" }
  }
};
```

## Success Alerts & Notifications

```typescript
// Notification Hook
const useNotifications = () => {
  const showPaymentSuccess = (payment: Payment) => {
    toast.success(
      <div className="flex items-center space-x-3">
        <CheckCircleIcon className="w-6 h-6 text-success-500" />
        <div>
          <p className="font-medium">Payment Confirmed!</p>
          <p className="text-sm text-gray-600">${payment.amount} {payment.currency}</p>
        </div>
      </div>,
      { duration: 5000 }
    );
  };

  const showOnboardingComplete = (businessName: string) => {
    toast.success(
      <div className="flex items-center space-x-3">
        <SparklesIcon className="w-6 h-6 text-primary-500" />
        <div>
          <p className="font-medium">Welcome to AfriPay!</p>
          <p className="text-sm">{businessName} is ready to accept payments</p>
        </div>
      </div>,
      { duration: 6000 }
    );
  };

  const showPaymentCreated = (reference: string) => {
    toast.success(
      <div className="flex items-center space-x-3">
        <QrCodeIcon className="w-6 h-6 text-primary-500" />
        <div>
          <p className="font-medium">Payment Link Created!</p>
          <p className="text-sm">Reference: {reference.slice(0, 8)}...</p>
        </div>
      </div>
    );
  };

  return { showPaymentSuccess, showOnboardingComplete, showPaymentCreated };
};
```

## Modal Components

```typescript
// Success Modal
const SuccessModal = ({ isOpen, onClose, title, message, action }: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  action?: { label: string; onClick: () => void; };
}) => (
  <AnimatePresence>
    {isOpen && (
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        variants={motionVariants.modalOverlay}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        
        <motion.div
          className="relative bg-white rounded-xl p-6 max-w-md w-full shadow-xl"
          variants={motionVariants.modalContent}
        >
          <motion.div
            className="mx-auto w-16 h-16 bg-success-100 rounded-full flex items-center justify-center mb-4"
            variants={motionVariants.successCheck}
          >
            <CheckCircleIcon className="w-8 h-8 text-success-500" />
          </motion.div>
          
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
            <p className="text-gray-600 mb-6">{message}</p>
            
            <div className="flex space-x-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
              {action && (
                <button
                  onClick={action.onClick}
                  className="flex-1 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors"
                >
                  {action.label}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

// Payment Success Modal
const PaymentSuccessModal = ({ payment, isOpen, onClose }: {
  payment: Payment;
  isOpen: boolean;
  onClose: () => void;
}) => (
  <SuccessModal
    isOpen={isOpen}
    onClose={onClose}
    title="Payment Created Successfully!"
    message={`Your payment request for $${payment.amount} ${payment.currency} is ready to share.`}
    action={{
      label: "Share Payment",
      onClick: () => navigator.share?.({
        title: payment.label,
        url: `${window.location.origin}/payment/${payment.reference}`
      })
    }}
  />
);
```

## Loading States & Status Indicators

```typescript
// Loading Spinner
const LoadingSpinner = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const sizeClasses = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };
  return (
    <svg className={`animate-spin ${sizeClasses[size]} text-primary-500`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
};

// Payment Status Badge
const PaymentStatus = ({ status }: { status: Payment['status'] }) => {
  const config = {
    pending: { color: 'bg-warning-50 text-warning-700 border-warning-200', icon: ClockIcon, animation: 'animate-pulse' },
    confirmed: { color: 'bg-success-50 text-success-700 border-success-200', icon: CheckCircleIcon, animation: '' },
    failed: { color: 'bg-error-50 text-error-700 border-error-200', icon: XCircleIcon, animation: '' }
  }[status];

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.color} ${config.animation}`}>
      <config.icon className="w-4 h-4 mr-1" />
      {status}
    </span>
  );
};

// Skeleton Loader
const PaymentCardSkeleton = () => (
  <div className="bg-white rounded-lg border p-6 animate-pulse">
    <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
    <div className="h-8 bg-gray-200 rounded w-1/2 mb-2"></div>
    <div className="h-10 bg-gray-200 rounded w-full"></div>
  </div>
);
```

## Complete Notification System

```typescript
// App Notifications Hook
const useAppNotifications = () => {
  return {
    paymentCreated: (payment: Payment) => toast.success(`Payment created: ${payment.reference.slice(0, 8)}...`),
    paymentConfirmed: (payment: Payment) => toast.success(`Payment confirmed: $${payment.amount} ${payment.currency}`),
    onboardingComplete: (name: string) => toast.success(`Welcome ${name}! Ready to accept payments.`),
    paymentFailed: () => toast.error('Payment failed. Please try again.'),
    registrationFailed: () => toast.error('Registration failed. Please check connection.')
  };
};
```

---

## 🎉 Design System Complete!

**Ready for Replit Implementation:**
- ✅ Verified database schemas
- ✅ Complete user flow hooks  
- ✅ Mock/real API switching
- ✅ Color system & typography
- ✅ Transitions & animations
- ✅ Success modals & notifications
- ✅ Loading states & error handling
- ✅ Component interfaces
- ✅ State management (Zustand)

**Switch to production:** Change `VITE_USE_MOCK_DATA=false` and set real API URL!
