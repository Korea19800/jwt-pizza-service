const config = require('../config.js').logging;

class Logger {
  /**
   * HTTP request logger middleware
   */
  httpLogger = (req, res, next) => {
    // Capture request start time
    req.startTime = Date.now();
    
    // Capture original send method
    let send = res.send;
    res.send = (resBody) => {
      // Calculate request duration
      const duration = Date.now() - req.startTime;
      
      const logData = {
        authorized: !!req.headers.authorization,
        path: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        reqBody: this.sanitize(req.body),
        resBody: this.sanitize(resBody),
        duration: `${duration}ms`
      };
      
      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, 'http', logData);
      
      // Restore original send
      res.send = send;
      return res.send(resBody);
    };
    next();
  };
  
  /**
   * Database query logger
   */
  dbLogger = (query, params) => {
    const startTime = Date.now();
    
    // Return a function that can be called when the query is complete
    return (error, results) => {
      const duration = Date.now() - startTime;
      
      const logData = {
        query: this.sanitizeSql(query),
        params: this.sanitize(params),
        error: error ? error.message : null,
        duration: `${duration}ms`,
        resultCount: results ? (Array.isArray(results) ? results.length : 1) : 0
      };
      
      const level = error ? 'error' : 'info';
      this.log(level, 'database', logData);
      
      return results;
    };
  };
  
  /**
   * Factory service request logger
   */
  factoryLogger = (url, method, requestBody) => {
    const startTime = Date.now();
    
    // Return a function that can be called when the response is received
    return (error, responseBody, statusCode) => {
      const duration = Date.now() - startTime;
      
      const logData = {
        url,
        method,
        requestBody: this.sanitize(requestBody),
        responseBody: this.sanitize(responseBody),
        statusCode,
        error: error ? error.message : null,
        duration: `${duration}ms`
      };
      
      const level = error || (statusCode >= 400) ? 'error' : 'info';
      this.log(level, 'factory', logData);
    };
  };
  
  /**
   * Exception logger
   */
  exceptionLogger = (err, req) => {
    const logData = {
      message: err.message,
      stack: err.stack,
      statusCode: err.statusCode || 500,
      path: req ? req.originalUrl : 'unknown',
      method: req ? req.method : 'unknown',
    };
    
    this.log('error', 'exception', logData);
  };
  
  /**
   * General logging method
   */
  log(level, type, logData) {
    const labels = { component: config.source, level, type };
    const values = [this.nowString(), this.sanitize(logData)];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };

    this.sendLogToGrafana(logEvent);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  /**
   * Sanitize sensitive data in logs
   */
  sanitize(data) {
    if (!data) return data;
    
    let stringData = typeof data === 'string' ? data : JSON.stringify(data);
    
    // Sanitize passwords
    stringData = stringData.replace(/\\"password\\":\s*\\"[^"]*\\"/g, '\\"password\\": \\"*****\\"');
    stringData = stringData.replace(/"password":\s*"[^"]*"/g, '"password": "*****"');
    
    // Sanitize authentication tokens
    stringData = stringData.replace(/\\"token\\":\s*\\"[^"]*\\"/g, '\\"token\\": \\"*****\\"');
    stringData = stringData.replace(/"token":\s*"[^"]*"/g, '"token": "*****"');
    stringData = stringData.replace(/Bearer\s+[^\s"]+/g, 'Bearer *****');
    
    // Sanitize API keys
    stringData = stringData.replace(/\\"apiKey\\":\s*\\"[^"]*\\"/g, '\\"apiKey\\": \\"*****\\"');
    stringData = stringData.replace(/"apiKey":\s*"[^"]*"/g, '"apiKey": "*****"');
    
    // Sanitize credit card info if present
    stringData = stringData.replace(/\\"creditCard\\":\s*\\"[^"]*\\"/g, '\\"creditCard\\": \\"*****\\"');
    stringData = stringData.replace(/"creditCard":\s*"[^"]*"/g, '"creditCard": "*****"');
    stringData = stringData.replace(/\\"cardNumber\\":\s*\\"[^"]*\\"/g, '\\"cardNumber\\": \\"*****\\"');
    stringData = stringData.replace(/"cardNumber":\s*"[^"]*"/g, '"cardNumber": "*****"');
    
    return stringData;
  }
  
  /**
   * Sanitize SQL queries to remove sensitive data
   */
  sanitizeSql(query) {
    if (!query) return query;
    
    // Replace password values in queries
    const sanitized = query.replace(/password\s*=\s*'[^']*'/gi, "password='*****'");
    
    return sanitized;
  }

  sendLogToGrafana(event) {
    const body = JSON.stringify(event);
    fetch(`${config.url}`, {
      method: 'post',
      body: body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.userId}:${config.apiKey}`,
      },
    }).then((res) => {
      if (!res.ok) console.log('Failed to send log to Grafana');
    }).catch(err => {
      console.error('Error sending log to Grafana:', err.message);
    });
  }
}

module.exports = new Logger();