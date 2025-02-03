const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  // Increase Jest timeout to 5 minutes if debugging in VSCode
  jest.setTimeout(60 * 1000 * 5);
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

// Create admin user
async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = `${user.name}@admin.com`;

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

async function getAdminAuth() {
  const adminUser = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(adminUser);
  return [loginRes.body.token, adminUser.email];
}

// Test: getFranchises
test('getFranchises', async () => {
  const getFranchisesRes = await request(app).get('/api/franchise');
  let franchiseQuantity = getFranchisesRes.body.length;

  await createFranchise();

  const getFranchisesRes2 = await request(app).get('/api/franchise');
  let newFranchiseQuantity = getFranchisesRes2.body.length;

  expect(getFranchisesRes.status).toBe(200);
  expect(newFranchiseQuantity).toBe(franchiseQuantity + 1);
});

// Test: createFranchise
test('createFranchise', createFranchise);

async function createFranchise() {
  let [token, email] = await getAdminAuth().then(([tok, em]) => [tok, em]);
  let randomFranchiseName = randomName();

  let newFranchise = {
    name: randomFranchiseName,
    admins: [{ email }]
  };

  const createFranchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${token}`)
    .send(newFranchise);

  expect(createFranchiseRes.status).toBe(200);
  expect(createFranchiseRes.body).toMatchObject({
    name: randomFranchiseName,
    admins: [{ email }]
  });

  return [email, token, createFranchiseRes.body.id];
}

// Test: deleteFranchise
test('deleteFranchise', async () => {
  let franchiseOwnerInfo = await createFranchise();
  let token = franchiseOwnerInfo[1];
  let franchiseId = franchiseOwnerInfo[2];

  const deleteFranchiseRes = await request(app)
    .delete(`/api/franchise/${franchiseId}`)
    .set('Authorization', `Bearer ${token}`);

  expect(deleteFranchiseRes.status).toBe(200);
  expect(deleteFranchiseRes.body).toMatchObject({ message: 'franchise deleted' });
});

// Test: createStore
test('createStore', async () => {
  let franchiseOwnerInfo = await createFranchise();
  let email = franchiseOwnerInfo[0];
  let token = franchiseOwnerInfo[1];
  let franchiseId = franchiseOwnerInfo[2];

  let newStore = {
    name: randomName(),
    admins: [{ email }]
  };

  const createStoreRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${token}`)
    .send(newStore);

  expect(createStoreRes.status).toBe(200);
  expect(createStoreRes.body).toMatchObject({ name: newStore.name });
});
