const config = require('./config');
const os = require('os');

// 2. OS code from deliv8
function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return parseFloat(cpuUsage.toFixed(2)) * 100;
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return parseFloat(memoryUsage.toFixed(2));
}

const metrics = {
  requests: {},
  responseTimes: {},
  statusCodes: {},
  methodCounts: {},
  totalRequests: 0, // Add a dedicated counter for total requests
  // 3. Purchase metrics
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
  },
  // Authentication metrics
  authentication: {
    attempts: 0,
    successful: 0,
    failed: 0,
    registrationAttempts: 0,
    successfulRegistrations: 0,
    failedRegistrations: 0
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
      // Registration attempt
      metrics.authentication.registrationAttempts++;
    } else if (endpoint === '/api/auth' && req.method === 'PUT') {
      // User login
      metrics.userActivity.logins++;
      // Login attempt
      metrics.authentication.attempts++;
      
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
  
  // Increment total request counter
  metrics.totalRequests++;
  
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
    
    // Track authentication success/failure based on status code and endpoint
    if (endpoint === '/api/auth') {
      if (req.method === 'PUT') { // Login endpoint
        if (statusCode >= 200 && statusCode < 300) {
          metrics.authentication.successful++;
        } else if (statusCode >= 400) {
          metrics.authentication.failed++;
        }
      } else if (req.method === 'POST') { // Registration endpoint
        if (statusCode >= 200 && statusCode < 300) {
          metrics.authentication.successfulRegistrations++;
        } else if (statusCode >= 400) {
          metrics.authentication.failedRegistrations++;
        }
      }
    }
  });

  next();
}

// Function to manually track authentication results
function trackAuthentication(isSuccessful, isRegistration = false) {
  if (isRegistration) {
    metrics.authentication.registrationAttempts++;
    if (isSuccessful) {
      metrics.authentication.successfulRegistrations++;
    } else {
      metrics.authentication.failedRegistrations++;
    }
  } else {
    metrics.authentication.attempts++;
    if (isSuccessful) {
      metrics.authentication.successful++;
    } else {
      metrics.authentication.failed++;
    }
  }
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
  // Total HTTP requests (from the dedicated counter)
  builder.addMetric('total_http_requests', metrics.totalRequests, { type: 'all' });
  
  // Total request count (from the endpoint tracking)
  builder.addMetric('total_endpoint_requests', metrics.requests['total'] || 0, { endpoint: 'all' });

  // Per-endpoint request count
  Object.keys(metrics.requests).forEach((endpoint) => {
    if (endpoint !== 'total') { // Skip the 'total' key as we already reported it
      builder.addMetric('requests', metrics.requests[endpoint], { endpoint });
    }
  });

  // Total requests by HTTP method
  let totalByMethods = 0;
  
  // HTTP Methods
  Object.keys(metrics.methodCounts).forEach((method) => {
    const count = metrics.methodCounts[method];
    totalByMethods += count;
    builder.addMetric('http_methods', count, { method });
  });
  
  // Add a combined total of all HTTP methods
  builder.addMetric('total_by_methods', totalByMethods, { type: 'all_methods' });

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
  // Get CPU and memory usage
  const cpuUsage = getCpuUsagePercentage();
  const memoryUsage = getMemoryUsagePercentage();
  
  // console.log(`Reporting system metrics - CPU: ${cpuUsage}%, Memory: ${memoryUsage}%`);
  
  // System metrics - ensure consistent naming and attributes
  builder.addMetric('system_cpu_usage_total', cpuUsage, { type: 'system' });
  builder.addMetric('system_memory_usage_total', memoryUsage, { type: 'system' });
}

function userMetrics(builder) {
  // User activity metrics
  builder.addMetric('user_active_count', metrics.userActivity.activeUsers.size, { type: 'active_users' });
  builder.addMetric('user_registrations', metrics.userActivity.registrations, { type: 'registrations' });
  builder.addMetric('user_logins', metrics.userActivity.logins, { type: 'logins' });
  builder.addMetric('user_logouts', metrics.userActivity.logouts, { type: 'logouts' });
  
  // Authentication metrics
  builder.addMetric('auth_attempts_total', metrics.authentication.attempts, { type: 'authentication' });
  builder.addMetric('auth_successful', metrics.authentication.successful, { type: 'authentication' });
  builder.addMetric('auth_failed', metrics.authentication.failed, { type: 'authentication' });
  builder.addMetric('auth_registration_attempts', metrics.authentication.registrationAttempts, { type: 'authentication' });
  builder.addMetric('auth_registration_successful', metrics.authentication.successfulRegistrations, { type: 'authentication' });
  builder.addMetric('auth_registration_failed', metrics.authentication.failedRegistrations, { type: 'authentication' });
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
  // Add specific auth metrics here if they're not covered in userMetrics
  // For now, we've integrated them into userMetrics
  if (builder) {
    // Just in case we want to add more auth-specific metrics in the future
  }
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

  // console.log(`Sending metric: ${metricData.name}, Value: ${metricData.value}`);

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
        //console.log(`Pushed ${metricData.name} successfully.`);
      }
    })
    .catch((error) => {
      console.error('Error pushing metrics:', error);
    });
}

// Function to get authentication metrics
function getAuthenticationMetrics() {
  return {
    login: {
      attempts: metrics.authentication.attempts,
      successful: metrics.authentication.successful,
      failed: metrics.authentication.failed,
      successRate: metrics.authentication.attempts > 0 
        ? (metrics.authentication.successful / metrics.authentication.attempts * 100).toFixed(2) 
        : 0
    },
    registration: {
      attempts: metrics.authentication.registrationAttempts,
      successful: metrics.authentication.successfulRegistrations,
      failed: metrics.authentication.failedRegistrations,
      successRate: metrics.authentication.registrationAttempts > 0
        ? (metrics.authentication.successfulRegistrations / metrics.authentication.registrationAttempts * 100).toFixed(2)
        : 0
    }
  };
}

// 4. Periodic Reporting Send metrics periodically
function sendMetricsPeriodically(period = 30000) {
  return setInterval(() => {
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
}

// Initialize metrics collection
sendMetricsPeriodically(30000);

module.exports = { 
  track, 
  requestTracker, 
  trackPurchase, 
  trackAuthentication,
  getAuthenticationMetrics
};
