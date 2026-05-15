// ============================================================================

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };
// Upgrade Page - Stripe Integration with Monthly & Yearly Plans
// ============================================================================

'use strict';

// Stripe Price IDs
const STRIPE_PRICES = {
  monthly: 'price_1TWOAXE3FV5aR9qEvdBOx8hI', // $9.99/month
  yearly:  'price_1TWOAXE3FV5aR9qE9NUCu9Ur'  // $99/year
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
  
  log(`💳 Plan switched to: ${plan}`);
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
  log(`🚀 Starting ${plan} checkout...`);
  

  try {
    const { userEmail } = await chrome.storage.local.get(['userEmail']);

    // Create checkout session via backend
    const response = await fetch('https://fauxspy.com/api/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan,
        email: userEmail || undefined
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Checkout failed: ${error}`);
    }
    
    const { url } = await response.json();

    // Redirect to Stripe Checkout
    log('✅ Redirecting to Stripe Checkout...');
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
  // After checkout, Stripe redirects to fauxspy.com/success.html where the
  // license key is emailed to the user. The user then enters it in Settings.
  const urlParams = new URLSearchParams(window.location.search);
  const cancelled = urlParams.get('cancelled');

  if (cancelled === 'true') {
    log('❌ Payment cancelled');
    alert('Payment was cancelled. No charges were made.');
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  log('🚀 Upgrade page loaded');
  
  // Check for payment callback
  await checkPaymentStatus();
  
  // Load user's current license
  const { license } = await chrome.storage.local.get('license');
  
  if (license?.isPro) {
    log('✅ User already has Pro');
    // Could show "Manage Subscription" instead
  }
  
  log('💳 Stripe integration ready');
  log(`   Monthly: ${STRIPE_PRICES.monthly}`);
  log(`   Yearly: ${STRIPE_PRICES.yearly}`);
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
