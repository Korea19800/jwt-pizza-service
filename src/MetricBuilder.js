class MetricBuilder {
    constructor() {
      this.resourceMetrics = [];
    }
  
    addMetric(metricName, metricValue, type, unit, attributes = {}) {
      // Format attributes for OTLP protocol
      const formattedAttributes = Object.entries(attributes).map(([key, value]) => ({
        key,
        value: { stringValue: String(value) }
      }));
  
      // Add timestamp in nanoseconds
      const timeUnixNano = BigInt(Date.now()) * BigInt(1000000); // Convert to nanoseconds
  
      // Create metric with proper OTLP format
      const metric = {
        scopeMetrics: [
          {
            scope: {
              name: "jwt-pizza-service",
            },
            metrics: [
              {
                name: metricName,
                unit: unit,
                [type]: {
                  dataPoints: [
                    {
                      // Use asInt or asDouble based on value type
                      [Number.isInteger(metricValue) ? "asInt" : "asDouble"]: metricValue,
                      timeUnixNano: String(timeUnixNano), // OTLP expects time as string
                      attributes: formattedAttributes
                    },
                  ],
                },
              },
            ],
          },
        ],
      };
  
      if (type === "sum") {
        metric.scopeMetrics[0].metrics[0][type].aggregationTemporality =
          "AGGREGATION_TEMPORALITY_CUMULATIVE";
        metric.scopeMetrics[0].metrics[0][type].isMonotonic = true;
      }
  
      this.resourceMetrics.push(metric);
      return this;
    }
  
    toJSON() {
      // Format for OTLP protocol with schema version
      return { 
        resourceMetrics: this.resourceMetrics,
        schemaUrl: "https://opentelemetry.io/schemas/1.0.0"
      };
    }
  }
  
  module.exports = {
    MetricBuilder,
  };