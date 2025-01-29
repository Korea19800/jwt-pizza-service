/**
 * @file __tests__/orderRouter.test.js
 */
const request = require('supertest');
const express = require('express');

// Router under test
const orderRouter = require('../routes/orderRouter');

// Mocking the DB calls
const { DB, Role } = require('../database/database');
jest.mock('../database/database');

// Mocking the authRouter so we can simulate authenticated/unauthenticated states
jest.mock('../routes/authRouter', () => ({
  authRouter: {
    authenticateToken: jest.fn((req, res, next) => {
      // Default: user is Admin with id=1
      req.user = {
        id: 1,
        name: 'Admin User',
        email: 'admin@example.com',
        roles: [{ role: 'Admin' }],
        isRole(role) {
          return this.roles.some((r) => r.role === role);
        },
      };
      next();
    }),
  },
}));

// We also mock config.js so we don't rely on real external URLs or secrets.
jest.mock('../config.js', () => ({
  factory: {
    url: 'http://mock-factory.com',
    apiKey: 'mockApiKey',
  },
}));

// We'll need to mock fetch (node-fetch or global.fetch). 
// If using Node 18+ with global fetch, we can override it like so:
global.fetch = jest.fn();

describe('orderRouter', () => {
  let app;

  beforeAll(() => {
    // Create an express app & mount the orderRouter
    app = express();
    app.use(express.json());
    // If in your real app you do app.use('/api/order', orderRouter),
    // you can replicate that. Here let's mount at root for simplicity:
    app.use('/', orderRouter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ----------------------------------------------------
  // GET /menu (No auth required)
  // ----------------------------------------------------
  describe('GET /menu', () => {
    it('should return the menu items', async () => {
      const mockMenu = [
        { id: 1, title: 'Veggie', price: 0.0038, description: 'A garden of delight' },
        { id: 2, title: 'Pepperoni', price: 0.0042, description: 'Classic favorite' },
      ];
      DB.getMenu.mockResolvedValue(mockMenu);

      const res = await request(app).get('/menu');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockMenu);
      expect(DB.getMenu).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------
  // PUT /menu (Auth required, Admin only)
  // ----------------------------------------------------
  describe('PUT /menu', () => {
    it('should allow an Admin user to add a menu item and return the updated menu', async () => {
      // By default, the auth mock sets req.user as an Admin
      const newMenuItem = {
        title: 'Student Pizza',
        description: 'No topping, just carbs',
        image: 'pizza9.png',
        price: 0.0001,
      };
      const mockMenu = [
        { id: 1, title: 'Veggie' },
        { id: 2, title: 'Student Pizza' },
      ];

      DB.addMenuItem.mockResolvedValue(undefined); // We don't usually return anything
      DB.getMenu.mockResolvedValue(mockMenu);

      const res = await request(app).put('/menu').send(newMenuItem);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockMenu);
      expect(DB.addMenuItem).toHaveBeenCalledWith(newMenuItem);
      expect(DB.getMenu).toHaveBeenCalled();
    });

    it('should return 403 if user is not an Admin', async () => {
      // Override default mock to pretend user is not admin
      const { authRouter } = require('../routes/authRouter');
      authRouter.authenticateToken.mockImplementation((req, res, next) => {
        req.user = {
          id: 2,
          roles: [{ role: 'User' }], // not Admin
          isRole(role) {
            return this.roles.some((r) => r.role === role);
          },
        };
        next();
      });

      const res = await request(app).put('/menu').send({
        title: 'Unauthorized Pizza',
        description: 'Nope',
      });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'unable to add menu item' });
      expect(DB.addMenuItem).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------
  // GET / (Get orders for the authenticated user)
  // ----------------------------------------------------
  describe('GET /', () => {
    it('should return orders for the user (page is optional)', async () => {
      // By default, user is Admin with id=1
      const mockOrders = {
        dinerId: 1,
        orders: [
          { id: 101, items: [], date: '2024-06-05T05:14:40.000Z' },
        ],
        page: 1,
      };
      DB.getOrders.mockResolvedValue(mockOrders);

      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockOrders);
      // getOrders is called with (req.user, req.query.page)
      expect(DB.getOrders).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), undefined);
    });

    it('should require authentication', async () => {
      // We can simulate "no token" by removing the user in the mock
      const { authRouter } = require('../routes/authRouter');
      authRouter.authenticateToken.mockImplementation((req, res, next) => {
        // do nothing, no user
        next();
      });

      const res = await request(app).get('/');
      // Since the route is protected, and we never set req.user,
      // `authenticateToken` middleware should produce a 401.
      // But check your actual `authRouter` implementation to confirm.
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'unauthorized' });
    });
  });

  // ----------------------------------------------------
  // POST / (Create a new order for the authenticated user)
  // ----------------------------------------------------
  describe('POST /', () => {
    const validOrderReq = {
      franchiseId: 1,
      storeId: 1,
      items: [
        { menuId: 1, description: 'Veggie', price: 0.05 },
      ],
    };

    it('should create a new order for the user and call the factory API', async () => {
      // DB.addDinerOrder returns the newly created order with an id
      const mockCreatedOrder = { ...validOrderReq, id: 999 };
      DB.addDinerOrder.mockResolvedValue(mockCreatedOrder);

      // The router calls fetch(...) to the factory
      // We'll mock a successful factory response
      const mockFactoryResponse = {
        reportUrl: 'http://mock-factory.com/report/123',
        jwt: 'mock-factory-jwt',
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockFactoryResponse,
      });

      const res = await request(app).post('/').send(validOrderReq);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        order: mockCreatedOrder,
        reportSlowPizzaToFactoryUrl: mockFactoryResponse.reportUrl,
        jwt: mockFactoryResponse.jwt,
      });
      // Check DB call
      expect(DB.addDinerOrder).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }), // user
        validOrderReq
      );

      // Check fetch call
      expect(global.fetch).toHaveBeenCalledWith(
        'http://mock-factory.com/api/order',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer mockApiKey`,
          },
          body: JSON.stringify({
            diner: {
              id: 1,
              name: 'Admin User',
              email: 'admin@example.com',
            },
            order: mockCreatedOrder,
          }),
        })
      );
    });

    it('should return 500 if the factory request fails', async () => {
      DB.addDinerOrder.mockResolvedValue({
        ...validOrderReq,
        id: 999,
      });

      // Mock a failing fetch
      global.fetch.mockResolvedValue({
        ok: false,
        json: async () => ({ reportUrl: 'http://mock-factory.com/error/123' }),
      });

      const res = await request(app).post('/').send(validOrderReq);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        message: 'Failed to fulfill order at factory',
        reportPizzaCreationErrorToPizzaFactoryUrl: 'http://mock-factory.com/error/123',
      });
    });

    it('should require authentication to create an order', async () => {
      const { authRouter } = require('../routes/authRouter');
      authRouter.authenticateToken.mockImplementation((req, res, next) => {
        // do nothing => no user
        next();
      });

      const res = await request(app).post('/').send(validOrderReq);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: 'unauthorized' });
      expect(DB.addDinerOrder).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
