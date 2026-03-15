const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'canceled', 'past_due'],
    default: 'inactive'
  },
  plan: {
    type: String,
    default: 'basic'
  },
  subscriptionId: {
    type: String, // Razorpay Subscription ID
    default: null
  },
  orderId: {
     type: String, // Initial Order ID
     default: null
  },
  paymentId: {
    type: String // Last successful Payment ID
  },
  expiresAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = Subscription;
