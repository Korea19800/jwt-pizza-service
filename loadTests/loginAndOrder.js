import { sleep, check, group, fail } from 'k6';
import http from 'k6/http';
import jsonpath from 'https://jslib.k6.io/jsonpath/1.0.2/index.js';

export const options = {
  cloud: {
    distribution: {
      'amazon:us:ashburn': { loadZone: 'amazon:us:ashburn', percent: 100 },
    },
    apm: [],
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
  scenarios: {
    LoginAndOrder: {
      executor: 'ramping-vus',
      stages: [
        { target: 5, duration: '30s' },
        { target: 15, duration: '1m' },
        { target: 10, duration: '30s' },
        { target: 0, duration: '30s' },
      ],
      gracefulStop: '30s',
      exec: 'loginAndOrder',
    },
  },
};

export function loginAndOrder() {
  let response;
  const vars = {};

  group('Scenario - Login and place order', function () {
    // Login
    response = http.put(
      'https://pizza-service.wheatharvest.llc/api/auth',
      JSON.stringify({ email: 'testing@wheatharvest.llc', password: 'ez2iBkeqwgpH32U' }),
      {
        headers: getHeaders({ contentType: true }),
      }
    );
    checkStatus(response, 'Login');

    const tokenMatch = jsonpath.query(response.json(), '$.token');
    if (!tokenMatch?.length) fail('Token not found in login response');
    vars['token1'] = tokenMatch[0];
    sleep(2);

    // Get Menu
    response = http.get(
      'https://pizza-service.wheatharvest.llc/api/order/menu',
      {
        headers: getHeaders({ token: vars['token1'], contentType: true }),
      }
    );
    sleep(0.5);

    // Get Franchises
    response = http.get(
      'https://pizza-service.wheatharvest.llc/api/franchise',
      {
        headers: getHeaders({ token: vars['token1'], contentType: true }),
      }
    );
    sleep(2);

    // Submit Order
    const order = {
      items: [
        { menuId: 2, description: 'Pepperoni', price: 0.0042 },
        { menuId: 4, description: 'Crusty', price: 0.0028 },
        { menuId: 1, description: 'Veggie', price: 0.0038 },
        { menuId: 1, description: 'Veggie', price: 0.0038 },
        { menuId: 1, description: 'Veggie', price: 0.0038 },
        { menuId: 7, description: 'Pepperoni', price: 0.0042 },
        { menuId: 7, description: 'Pepperoni', price: 0.0042 },
        { menuId: 10, description: 'Charred Leopard', price: 0.0099 },
      ],
      storeId: '1',
      franchiseId: 1,
    };

    response = http.post(
      'https://pizza-service.wheatharvest.llc/api/order',
      JSON.stringify(order),
      {
        headers: getHeaders({ token: vars['token1'], contentType: true }),
      }
    );
    checkStatus(response, 'Submit order');

    const jwtMatch = jsonpath.query(response.json(), '$.jwt');
    if (!jwtMatch?.length) fail('JWT not found in order response');
    vars['jwt1'] = jwtMatch[0];
    sleep(1.5);

    // Verify Order
    response = http.post(
      'https://pizza-factory.cs329.click/api/order/verify',
      JSON.stringify({ jwt: vars['jwt1'] }),
      {
        headers: getHeaders({
          token: vars['token1'],
          contentType: true,
          origin: 'https://pizza.wheatharvest.llc',
          crossSite: true,
        }),
      }
    );
    checkStatus(response, 'Verify order');
    console.log('✔ Order verified successfully');
  });
}

// 헬퍼 함수들
function checkStatus(res, label) {
  const ok = check(res, {
    [`${label} status is 200`]: (r) => r.status === 200,
  });
  if (!ok) {
    console.error(`${label} failed:`, res.body);
    fail(`${label} was not successful`);
  }
}

function getHeaders({ token = '', contentType = false, origin = 'https://pizza.wheatharvest.llc', crossSite = false } = {}) {
  const headers = {
    accept: '*/*',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9',
    origin: origin,
    priority: 'u=1, i',
    'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': crossSite ? 'cross-site' : 'same-site',
  };

  if (token) headers['authorization'] = `Bearer ${token}`;
  if (contentType) headers['content-type'] = 'application/json';

  return headers;
}
