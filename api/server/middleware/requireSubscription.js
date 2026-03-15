const Subscription = require('../../models/Subscription');

const requireSubscription = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const subscription = await Subscription.findOne({ user: req.user.id });
    
    if (subscription && subscription.status === 'active' && new Date() < subscription.expiresAt) {
      return next();
    }
    
    return res.status(403).json({ 
      error: 'Subscription required',
      code: 'SUBSCRIPTION_REQUIRED',
      redirect: '/payment' 
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = requireSubscription;
