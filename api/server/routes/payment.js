const express = require('express');
const router = express.Router();
const {
  createOrder,
  verifyPayment,
  getStatus
} = require('../controllers/PaymentController');
console.log('PaymentController imports:', { createOrder: !!createOrder, verifyPayment: !!verifyPayment, getStatus: !!getStatus });

const accessPermissions = require('./accessPermissions');
const checkBan = require('../middleware/checkBan');
const limiters = require('../middleware/limiters');

// Apply protection if needed
// router.use(accessPermissions);

router.post('/order', createOrder);
router.post('/create-order', createOrder); // Alias
router.post('/verify', verifyPayment);
router.get('/status', getStatus);
// router.post('/webhook', webhookHandler);

module.exports = router;
