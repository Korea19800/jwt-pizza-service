const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); 
}

function randomName() {
    return Math.random().toString(36).substring(2, 12);
    }

let menuItem = {id: 1, title: 'Veggie', image: 'pizza1.png', 
    price: 0.0038, description: 'A garden of delight'}

// make random user
const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };

async function createUser() {
    testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
    const registerRes = await request(app).post('/api/auth').send(testUser);
    let testUserAuthToken = registerRes.body.token;
    expectValidJwt(testUserAuthToken);
    return testUserAuthToken;
  };

function expectValidJwt(potentialJwt) {
expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

// Create admin user
async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

async function getAdminAuth() {
    const adminUser = await createAdminUser();
    const loginRes = await request(app).put('/api/auth').send(adminUser);
    return loginRes.body.token;
}

test('getMenu', async () => {
    let newMenuItem = menuItem;
    newMenuItem.title = randomName();
    delete newMenuItem.id;
    await addMenuItem(menuItem);
    const getMenuRes = await request(app).get('/api/order/menu');
    expect(getMenuRes.status).toBe(200);
    expect(getMenuRes.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining(menuItem)
        ]))});

async function addMenuItemTest() {
  let newMenuItem = menuItem;
    newMenuItem.title = randomName();
    delete newMenuItem.id;
  await addMenuItem(menuItem);
};

async function addMenuItem(newMenuItem) {
    let auth = await getAdminAuth();
    const addMenuItemRes = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${auth}`).send(newMenuItem);
    
    expect(addMenuItemRes.status).toBe(200);
    expect(addMenuItemRes.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining(newMenuItem)]))
    return addMenuItemRes.body;
};

test('addMenuItem', addMenuItemTest);

async function orderItem() {
    let auth = await createUser();
    let order = {franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }]};
    const orderRes = await request(app).post('/api/order').set('Authorization', `Bearer ${auth}`).send(order);
    expect(orderRes.status).toBe(200);
    expect(orderRes.body).toEqual(
        expect.objectContaining({
          order: expect.objectContaining(order)
        }))
    return auth
};

test('orderItem', orderItem);

test('getOrders', async () => {
    let auth = await orderItem();
    const getOrdersRes = await request(app).get('/api/order').set('Authorization', `Bearer ${auth}`);
    expect(getOrdersRes.status).toBe(200);
    expect(getOrdersRes.body.orders.length).toBe(1);
});
