/**
 * authRouter.test.js
 */
const request = require('supertest');
const app = require('../service'); // your Express app that uses authRouter

// Helper to check JWT format
function expectValidJwt(potentialJwt) {
  // Basic regex test to ensure we have a `header.payload.signature` structure
  expect(potentialJwt).toMatch(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/);
}

describe('authRouter', () => {
  let testUser = {
    name: 'pizza diner',
    email: 'reg@test.com',
    password: 'a'
  };
  let testUserAuthToken;
  let testUserId;

  //
  // 1) Register a user before all tests (demonstrates the POST /api/auth)
  //
  beforeAll(async () => {
    // Make sure email is unique each test run
    testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';

    // Attempt to register the new user
    const registerRes = await request(app)
      .post('/api/auth')
      .send(testUser);

    expect(registerRes.status).toBe(200);
    expect(registerRes.body.user).toBeDefined();
    expect(registerRes.body.token).toBeDefined();
    expectValidJwt(registerRes.body.token);

    testUserAuthToken = registerRes.body.token;
    testUserId = registerRes.body.user.id; // Store the user ID for later use
  });

  //
  // 2) Test registration error when missing required fields
  //
  test('register fails with missing fields', async () => {
    // Omit 'name'
    const incompleteUser = {
      email: 'incomplete@test.com',
      password: 'secret',
    };

    const res = await request(app)
      .post('/api/auth')
      .send(incompleteUser);

    // The router checks for name, email, password => 400 if missing
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/required/i);
  });

  //
  // 3) Login existing user (PUT /api/auth)
  //
  test('login with valid credentials', async () => {
    const loginRes = await request(app)
      .put('/api/auth')
      .send({
        email: testUser.email,
        password: testUser.password
      });

    expect(loginRes.status).toBe(200);
    expectValidJwt(loginRes.body.token);

    // We expect the user to be returned, minus the raw password
    const expectedUser = {
      ...testUser,
      roles: [{ role: 'diner' }]
    };
    delete expectedUser.password;
    expect(loginRes.body.user).toMatchObject(expectedUser);
  });

  //
  // 4) Login with invalid credentials (assuming DB.getUser returns null -> we handle gracefully)
  //
  test('login with invalid credentials fails', async () => {
    const invalidLoginRes = await request(app)
      .put('/api/auth')
      .send({
        email: testUser.email,
        password: 'wrongPassword'
      });

    // Adjust depending on your actual error handling. 
    // If your code doesn't yet handle "user not found" gracefully,
    // you may need to update authRouter to return 401 or 400 explicitly.
    expect(invalidLoginRes.status).toBeGreaterThanOrEqual(400);
    // e.g. 401 or 400
    // Just check there's an error message or something:
    expect(invalidLoginRes.body.message).toBeDefined();
  });

  //
  // 5) Update the user (PUT /api/auth/:userId) with an authorized token
  //
  test('update user with valid token & matching userId', async () => {
    const newEmail = 'newEmail@test.com';
    const updateRes = await request(app)
      .put(`/api/auth/${testUserId}`)
      .set('Authorization', `Bearer ${testUserAuthToken}`)
      .send({
        email: newEmail,
        password: 'newsecret'
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.email).toBe(newEmail); 
    // The response is the updated user object
    // e.g. { id, name, email, roles }
  });

  //
  // 6) Update another user as a non-admin => should fail with 403
  //
  test('update other user as non-admin fails', async () => {
    const otherUserId = 999999; // Some dummy ID that isn't the same as testUserId
    const res = await request(app)
      .put(`/api/auth/${otherUserId}`)
      .set('Authorization', `Bearer ${testUserAuthToken}`)
      .send({
        email: 'attempted-unauthorized@test.com'
      });

    // The router checks "if (user.id !== userId && !user.isRole(Role.Admin)) { ... 403 }"
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/unauthorized/i);
  });

  //
  // 7) Logout with valid token (DELETE /api/auth)
  //
  test('logout with valid token', async () => {
    const logoutRes = await request(app)
      .delete('/api/auth')
      .set('Authorization', `Bearer ${testUserAuthToken}`);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.message).toBe('logout successful');
  });

  //
  // 8) Logout with no/invalid token => 401 unauthorized
  //
  test('logout with no token fails', async () => {
    const logoutRes = await request(app)
      .delete('/api/auth'); // no Authorization header

    expect(logoutRes.status).toBe(401);
    expect(logoutRes.body.message).toMatch(/unauthorized/i);
  });
});
