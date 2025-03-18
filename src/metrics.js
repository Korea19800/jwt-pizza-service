// example metrics.js -> need to fix
const config = require('./config');
const os = require('os');

// given os code from deliv8
function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return cpuUsage.toFixed(2) * 100;
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return memoryUsage.toFixed(2);
}

const metrics = {
  requests: {},
  responseTimes: {},
  statusCodes: {},
  methodCounts: {},
  // Purchase metrics
  purchases: {
    total: 0,
    successful: 0,
    failed: 0,
    totalPizzas: 0,
    totalCost: 0,
    factoryResponseTimes: []
  },
  // User activity metrics
  userActivity: {
    activeUsers: new Set(),
    registrations: 0,
    logins: 0,
    logouts: 0
  }
};

function track(endpoint) {
  return (req, res, next) => {
    metrics.requests[endpoint] = (metrics.requests[endpoint] || 0) + 1;
    metrics.requests['total'] = (metrics.requests['total'] || 0) + 1;
    
    // Track user activity for authentication-related endpoints
    if (endpoint === '/api/auth' && req.method === 'POST') {
      // New user registration
      metrics.userActivity.registrations++;
    } else if (endpoint === '/api/auth' && req.method === 'PUT') {
      // User login
      metrics.userActivity.logins++;
      if (req.body && req.body.email) {
        metrics.userActivity.activeUsers.add(req.body.email);
      }
    } else if (endpoint === '/api/auth' && req.method === 'DELETE') {
      // User logout
      metrics.userActivity.logouts++;
      if (req.user && req.user.email) {
        metrics.userActivity.activeUsers.delete(req.user.email);
      }
    }
    
    next();
  };
}

function requestTracker(req, res, next) {
  const start = Date.now();
  
  // Track HTTP method
  const method = req.method;
  metrics.methodCounts[method] = (metrics.methodCounts[method] || 0) + 1;

  // Add response finish handler
  res.on('finish', () => {
    // Track response time
    const duration = Date.now() - start;
    const endpoint = req.path;
    
    metrics.responseTimes[endpoint] = metrics.responseTimes[endpoint] || { count: 0, total: 0 };
    metrics.responseTimes[endpoint].count++;
    metrics.responseTimes[endpoint].total += duration;

    // Track status codes
    const statusCode = res.statusCode;
    const statusCodeKey = Math.floor(statusCode / 100) + 'xx';
    metrics.statusCodes[statusCodeKey] = (metrics.statusCodes[statusCodeKey] || 0) + 1;
  });

  next();
}

// Function to track purchase metrics
function trackPurchase(orderData, factoryResponseTime, isSuccessful) {
  // Count total purchases
  metrics.purchases.total++;
  
  // Track success/failure
  if (isSuccessful) {
    metrics.purchases.successful++;
  } else {
    metrics.purchases.failed++;
  }
  
  // Track factory response time
  metrics.purchases.factoryResponseTimes.push(factoryResponseTime);
  
  // Calculate total pizzas in the order
  if (orderData && orderData.items) {
    // Assuming each item in the order represents a pizza
    const pizzaCount = orderData.items.length;
    metrics.purchases.totalPizzas += pizzaCount;
    
    // Calculate total cost
    const orderCost = orderData.items.reduce((total, item) => total + (item.price || 0), 0);
    metrics.purchases.totalCost += orderCost;
  }
}

// MetricBuilder class for organizing metrics
class MetricBuilder {
  constructor() {
    this.metricsData = [];
  }

  addMetric(name, value, attributes) {
    this.metricsData.push({
      name,
      value,
      attributes: { ...attributes, source: config.metrics.source }
    });
    return this;
  }

  getMetrics() {
    return this.metricsData;
  }
}

// Functions to collect different types of metrics
function httpMetrics(builder) {
  // Total request count
  builder.addMetric('total_requests', metrics.requests['total'] || 0, { endpoint: 'all' });

  // Per-endpoint request count
  Object.keys(metrics.requests).forEach((endpoint) => {
    builder.addMetric('requests', metrics.requests[endpoint], { endpoint });
  });

  // HTTP Methods
  Object.keys(metrics.methodCounts).forEach((method) => {
    builder.addMetric('http_methods', metrics.methodCounts[method], { method });
  });

  // Status Codes
  Object.keys(metrics.statusCodes).forEach((statusCode) => {
    builder.addMetric('status_codes', metrics.statusCodes[statusCode], { status: statusCode });
  });

  // Average Response Times
  Object.keys(metrics.responseTimes).forEach((endpoint) => {
    const { count, total } = metrics.responseTimes[endpoint];
    if (count > 0) {
      const avgResponseTime = total / count;
      builder.addMetric('response_time_ms', avgResponseTime, { endpoint });
    }
  });
}

function systemMetrics(builder) {
  // System metrics
  builder.addMetric('system_cpu_usage', getCpuUsagePercentage(), { type: 'cpu' });
  builder.addMetric('system_memory_usage', getMemoryUsagePercentage(), { type: 'memory' });
}

function userMetrics(builder) {
  // User activity metrics
  builder.addMetric('user_active_count', metrics.userActivity.activeUsers.size, { type: 'active_users' });
  builder.addMetric('user_registrations', metrics.userActivity.registrations, { type: 'registrations' });
  builder.addMetric('user_logins', metrics.userActivity.logins, { type: 'logins' });
  builder.addMetric('user_logouts', metrics.userActivity.logouts, { type: 'logouts' });
}

function purchaseMetrics(builder) {
  // Purchase metrics
  builder.addMetric('purchase_count_total', metrics.purchases.total, { type: 'all' });
  builder.addMetric('purchase_count_successful', metrics.purchases.successful, { type: 'successful' });
  builder.addMetric('purchase_count_failed', metrics.purchases.failed, { type: 'failed' });
  builder.addMetric('purchase_total_pizzas', metrics.purchases.totalPizzas, { type: 'count' });
  builder.addMetric('purchase_total_cost', metrics.purchases.totalCost, { type: 'cost' });
  
  // Calculate average factory response time
  if (metrics.purchases.factoryResponseTimes.length > 0) {
    const avgFactoryResponseTime = metrics.purchases.factoryResponseTimes.reduce((a, b) => a + b, 0) / metrics.purchases.factoryResponseTimes.length;
    builder.addMetric('purchase_factory_response_time_ms', avgFactoryResponseTime, { type: 'response_time' });
  }
}

function authMetrics(builder) {
  // Authentication metrics are already covered in userMetrics
  // We could add more specific auth metrics here if needed
}

function sendMetricToGrafana(metricData) {
  const metric = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: metricData.name,
                unit: '1',
                sum: {
                  dataPoints: [
                    {
                      asInt: metricData.value,
                      timeUnixNano: Date.now() * 1000000, // 나노초 단위
                      attributes: [],
                    },
                  ],
                  aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
                  isMonotonic: true,
                },
              },
            ],
          },
        ],
      },
    ],
  };

  Object.keys(metricData.attributes).forEach((key) => {
    metric.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: metricData.attributes[key] },
    });
  });

  console.log(`Sending metric: ${metricData.name}, Value: ${metricData.value}`);

  return fetch(`${config.metrics.url}`, {
    method: 'POST',
    body: JSON.stringify(metric),
    headers: {
      Authorization: `Bearer ${config.metrics.apiKey}`,
      'Content-Type': 'application/json',
    },
  })
    .then((response) => {
      if (!response.ok) {
        console.error('Failed to push metrics data to Grafana', response);
      } else {
        console.log(`Pushed ${metricData.name} successfully.`);
      }
    })
    .catch((error) => {
      console.error('Error pushing metrics:', error);
    });
}

// Send metrics periodically
function sendMetricsPeriodically(period = 10000) {
  const timer = setInterval(() => {
    try {
      const builder = new MetricBuilder();
      httpMetrics(builder);
      systemMetrics(builder);
      userMetrics(builder);
      purchaseMetrics(builder);
      authMetrics(builder);

      const metricsToSend = builder.getMetrics();
      
      // Send all metrics in parallel
      Promise.all(metricsToSend.map(metric => sendMetricToGrafana(metric)))
        .catch(error => console.error('Error sending metrics batch:', error));
        
    } catch (error) {
      console.log('Error collecting metrics', error);
    }
  }, period);
  
  return timer;
}

// Start the metrics collection
const metricsTimer = sendMetricsPeriodically(10000);

module.exports = { track, requestTracker, trackPurchase };


/* prev example code
const config = require('./config');

const requests = {};

function track(endpoint) {
  return (req, res, next) => {
    requests[endpoint] = (requests[endpoint] || 0) + 1;
    next();
  };
}

// This will periodically send metrics to Grafana
const timer = setInterval(() => {
  Object.keys(requests).forEach((endpoint) => {
    sendMetricToGrafana('requests', requests[endpoint], { endpoint });
  });
}, 10000);

function sendMetricToGrafana(metricName, metricValue, attributes) {
  attributes = { ...attributes, source: config.source };

  const metric = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: metricName,
                unit: '1',
                sum: {
                  dataPoints: [
                    {
                      asInt: metricValue,
                      timeUnixNano: Date.now() * 1000000,
                      attributes: [],
                    },
                  ],
                  aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
                  isMonotonic: true,
                },
              },
            ],
          },
        ],
      },
    ],
  };

  Object.keys(attributes).forEach((key) => {
    metric.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].attributes.push({
      key: key,
      value: { stringValue: attributes[key] },
    });
  });
  
  console.log(config.apiKey);
  console.log(metric);

  fetch(`${config.url}`, {
    method: 'POST',
    body: JSON.stringify(metric),
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
  })
    .then((response) => {
      if (!response.ok) {
        console.error('Failed to push metrics data to Grafana');
        console.log(response)
      } else {
        console.log(`Pushed ${metricName}`);
      }
    })
    .catch((error) => {
      console.error('Error pushing metrics:', error);
    });
}

module.exports = { track };
*/