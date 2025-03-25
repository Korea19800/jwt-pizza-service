const config = require('./config.js');
const logger = require('./logging/logger.js');

/**
 * Factory Service wrapper with logging
 */
class FactoryService {
  /**
   * Send a request to the factory service with logging
   * 
   * @param {string} endpoint - The endpoint to call on the factory service
   * @param {string} method - HTTP method (GET, POST, etc)
   * @param {object} body - Request body
   * @returns {Promise<object>} - Response from the factory
   */
  async sendRequest(endpoint, method, body) {
    const url = `${config.factory.url}${endpoint}`;
    const requestBody = body ? JSON.stringify(body) : undefined;
    
    // Create logger callback
    const logCallback = logger.factoryLogger(url, method, body);
    
    try {
      const response = await fetch(url, {
        method: method,
        headers: { 
          'Content-Type': 'application/json', 
          authorization: `Bearer ${config.factory.apiKey}` 
        },
        body: requestBody,
      });
      
      const responseBody = await response.json();
      
      // Log the request
      logCallback(null, responseBody, response.status);
      
      return {
        ok: response.ok,
        status: response.status,
        body: responseBody
      };
    } catch (error) {
      // Log the error
      logCallback(error, null, 0);
      throw error;
    }
  }
  
  /**
   * Send an order to the factory
   * 
   * @param {object} diner - The diner information
   * @param {object} order - The order details
   * @returns {Promise<object>} - Response from the factory
   */
  async sendOrder(diner, order) {
    return this.sendRequest('/api/order', 'POST', { diner, order });
  }
}

module.exports = new FactoryService(); 