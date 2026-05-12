// ============================================================================
// Upgrade Page - Stripe Integration with Monthly & Yearly Plans
// ============================================================================

'use strict';

// Stripe Price IDs
const STRIPE_PRICES = {
  monthly: 'price_1T0SzwEPHQ3lnrIPuD8EOiIv', // $9.99/month
  yearly: 'price_YEARLY_PLACEHOLDER'          // $99/year - TO BE CREATED
};

// State
let currentPlan = 'monthly'; // 'monthly' or 'yearly'

// DOM Elements
const toggleSwitch = document.getElementById('toggleSwitch');
const monthlyOption = document.getElementById('monthlyOption');
const yearlyOption = document.getElementById('yearlyOption');
const proMonthly = document.getElementById('proMonthly');
const proYearly = document.getElementById('proYearly');
const monthlyButton = document.getElementById('monthlyButton');
const yearlyButton = document.getElementById('yearlyButton');

// ============================================================================
// PLAN TOGGLE
// ============================================================================

function switchPlan(plan) {
  currentPlan = plan;
  
  if (plan === 'yearly') {
    // Update toggle
    toggleSwitch.classList.add('yearly');
    monthlyOption.classList.remove('active');
    yearlyOption.classList.add('active');
    
    // Show yearly card, hide monthly
    proMonthly.style.display = 'none';
    proYearly.style.display = 'block';
  } else {
    // Update toggle
    toggleSwitch.classList.remove('yearly');
    monthlyOption.classList.add('active');
    yearlyOption.classList.remove('active');
    
    // Show monthly card, hide yearly
    proMonthly.style.display = 'block';
    proYearly.style.display = 'none';
  }
  
  console.log(`💳 Plan switched to: ${plan}`);
}

// Toggle click handlers
toggleSwitch.addEventListener('click', () => {
  switchPlan(currentPlan === 'monthly' ? 'yearly' : 'monthly');
});

monthlyOption.addEventListener('click', () => switchPlan('monthly'));
yearlyOption.addEventListener('click', () => switchPlan('yearly'));

// ============================================================================
// STRIPE CHECKOUT
// ============================================================================

async function startCheckout(plan) {
  console.log(`🚀 Starting ${plan} checkout...`);
  
  const priceId = STRIPE_PRICES[plan];
  
  if (!priceId || priceId.includes('PLACEHOLDER')) {
    alert(`Yearly plan coming soon! Please choose the monthly plan for now, or contact support to set up yearly billing.`);
    return;
  }
  
  try {
    // Get or create customer ID
    let { customerId, userEmail } = await chrome.storage.local.get(['customerId', 'userEmail']);
    
    if (!customerId) {
      // Generate unique customer ID
      customerId = 'cus_' + Math.random().toString(36).substring(2, 15);
      await chrome.storage.local.set({ customerId });
    }
    
    // Create checkout session via backend
    const response = await fetch('https://ai-detector-backend-gamma.vercel.app/api/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        priceId,
        customerId,
        email: userEmail,
        plan: plan // 'monthly' or 'yearly'
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Checkout failed: ${error}`);
    }
    
    const { sessionId, url } = await response.json();
    
    // Save session info
    await chrome.storage.local.set({
      pendingCheckout: {
        sessionId,
        priceId,
        plan,
        timestamp: Date.now()
      }
    });
    
    // Redirect to Stripe Checkout
    console.log('✅ Redirecting to Stripe Checkout...');
    window.location.href = url;
    
  } catch (error) {
    console.error('❌ Checkout error:', error);
    alert(`Failed to start checkout: ${error.message}\n\nPlease try again or contact support.`);
  }
}

// Button click handlers
monthlyButton.addEventListener('click', () => startCheckout('monthly'));
yearlyButton.addEventListener('click', () => startCheckout('yearly'));

// ============================================================================
// CHECK FOR SUCCESSFUL PAYMENT
// ============================================================================

async function checkPaymentStatus() {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session_id');
  const success = urlParams.get('success');
  
  if (success === 'true' && sessionId) {
    console.log('✅ Payment successful! Session:', sessionId);
    
    try {
      // Verify session and activate license
      const response = await fetch('https://ai-detector-backend-gamma.vercel.app/api/verify-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId })
      });
      
      if (!response.ok) {
        throw new Error('Failed to verify payment');
      }
      
      const data = await response.json();
      
      // Save license info
      const license = {
        isPro: true,
        plan: data.plan || 'monthly',
        customerId: data.customerId,
        subscriptionId: data.subscriptionId,
        status: 'active',
        activatedAt: Date.now(),
        expiresAt: data.expiresAt
      };
      
      await chrome.storage.local.set({ 
        license,
        pendingCheckout: null 
      });
      
      // Show success message
      showSuccessMessage(data.plan);
      
    } catch (error) {
      console.error('❌ Verification error:', error);
      alert('Payment successful but verification failed. Please contact support with your session ID: ' + sessionId);
    }
  } else if (success === 'false') {
    console.log('❌ Payment cancelled');
    alert('Payment was cancelled. No charges were made.');
  }
}

function showSuccessMessage(plan) {
  const message = plan === 'yearly' 
    ? '🎉 Welcome to Pro (Yearly)!\n\nYou now have unlimited scans for a full year!\n\nSaving you $20.88 compared to monthly billing.'
    : '🎉 Welcome to Pro!\n\nYou now have unlimited scans and advanced features!';
  
  alert(message);
  
  // Redirect to popup after 2 seconds
  setTimeout(() => {
    window.close();
  }, 2000);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  console.log('🚀 Upgrade page loaded');
  
  // Check for payment callback
  await checkPaymentStatus();
  
  // Load user's current license
  const { license } = await chrome.storage.local.get('license');
  
  if (license?.isPro) {
    console.log('✅ User already has Pro');
    // Could show "Manage Subscription" instead
  }
  
  console.log('💳 Stripe integration ready');
  console.log(`   Monthly: ${STRIPE_PRICES.monthly}`);
  console.log(`   Yearly: ${STRIPE_PRICES.yearly}`);
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
