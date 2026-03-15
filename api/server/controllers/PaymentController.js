const Razorpay = require('razorpay');
const crypto = require('crypto');
const Subscription = require('../../models/Subscription');

// Initialize Razorpay
// TODO: Replace with env vars in librechat configuration
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'your_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'your_key_secret',
});

// Create Order for One-Time Access or Subscription
const createOrder = async (req, res) => {
  try {
    const { amount, currency } = req.body;
    // Basic options, can be extended for Subscriptions API
    const options = {
      amount: amount * 100, // amount in smallest currency unit
      currency: currency || 'INR',
      receipt: `order_${Date.now()}`,
      notes: { userId: req.user.id },
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    res.status(500).send(error);
  }
};

// Create a razorpay subscription via API
// This is for recurring payments
const createSubscription = async (req, res) => {
    try {
        const { planId } = req.body;
        // Check if plan exists...

        const subscription = await razorpay.subscriptions.create({
            plan_id: planId || process.env.RAZORPAY_PLAN_ID,
            total_count: 12, // example: 12 months
            quantity: 1,
            customer_notify: 1,
            notes: { userId: req.user.id }
        });

        res.json({ subscriptionId: subscription.id, key: razorpay.key_id });

    } catch (error) {
        console.error("Subscription creation failed:", error);
        res.status(500).json({ error: error.message });
    }
}


// Verify Payment
const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // Payment is successful
      // Find or create subscription record
      let sub = await Subscription.findOne({ user: req.user.id });
      if (!sub) {
        sub = new Subscription({ user: req.user.id });
      }

      sub.status = 'active';
      sub.paymentId = razorpay_payment_id;
      sub.orderId = razorpay_order_id;
      sub.expiresAt = new Date(new Date().setMonth(new Date().getMonth() + 1)); // Example: 1 month access
      await sub.save();

      res.json({ status: 'success', subscription: sub });
    } else {
      res.status(400).json({ status: 'failure', message: 'Invalid signature' });
    }
  } catch (error) {
    res.status(500).send(error);
  }
};

// Verify Subscription (Recurring)
const verifySubscription = async (req, res) => {
    try {
        const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body; 

        // Signature Verification for Subscription
        // razorpay_payment_id + | + razorpay_subscription_id
        const body = razorpay_payment_id + '|' + razorpay_subscription_id; 

        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature === razorpay_signature) {
             let sub = await Subscription.findOne({ user: req.user.id });
             if (!sub) {
                 sub = new Subscription({ user: req.user.id });
             }
             
             sub.status = 'active';
             sub.subscriptionId = razorpay_subscription_id;
             sub.paymentId = razorpay_payment_id;
             // With subscriptions, razorpay manages expiry but we can store local state
             sub.expiresAt = new Date(new Date().setMonth(new Date().getMonth() + 1)); 
             await sub.save();

             res.json({ status: 'success', subscription: sub });
        } else {
             res.status(400).json({ status: 'failure', message: 'Invalid signature' });
        }

    } catch(error) {
        res.status(500).json({ error: error.message });
    }
}

const getStatus = async (req, res) => {
  try {
    const sub = await Subscription.findOne({ user: req.user.id });
    if (!sub) {
      return res.json({ status: 'inactive' });
    }
    
    // Check if expired
    if (sub.expiresAt && new Date() > sub.expiresAt) {
      sub.status = 'inactive'; // Update logic if needed
      await sub.save();
    }

    res.json({ status: sub.status, expiresAt: sub.expiresAt, plan: sub.plan });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

module.exports = {
  createOrder,
  createSubscription,
  verifyPayment,
  verifySubscription,
  getStatus
};
