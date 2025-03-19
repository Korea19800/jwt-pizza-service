class MetricBuilder {
    constructor() {
      this.resourceMetrics = [];
    }
  
    addMetric(metricName, metricValue, type, unit) {
      const metric = {
        scopeMetrics: [
          {
            metrics: [
              {
                name: metricName,
                unit: unit,
                [type]: {
                  dataPoints: [
                    {
                      asInt: metricValue,
                      timeUnixNano: Date.now() * 1000000, // Convert milliseconds to nanoseconds
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
    }
  
    toJSON() {
      return { resourceMetrics: this.resourceMetrics };
    }
  }
  
  module.exports = {
    MetricBuilder,
  };