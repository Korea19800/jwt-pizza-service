/**
 * @file __tests__/franchiseRouter.test.js
 */
const request = require('supertest');
const express = require('express');

// The router under test
const franchiseRouter = require('../routes/franchiseRouter');

// Mocking DB and Role from ../database/database.js
const { DB, Role } = require('../database/database');
jest.mock('../database/database');

// We will also mock the authentication middleware
// so we can control whether req.user is set or not.
jest.mock('../routes/authRouter', () => {
  return {
    authRouter: {
      authenticateToken: jest.fn((req, res, next) => {
        // By default, let's assume the user is an Admin with id = 1
        req.user = {
          id: 1,
          roles: [{ role: 'Admin' }],
          isRole(role) {
            return this.roles.some((r) => r.role === role);
          },
        };
        next();
      }),
    },
  };
});

describe('franchiseRouter', () => {
  let app;

  beforeAll(() => {
    // Create an express app, mount the router
    app = express();
    app.use(express.json());
    // The franchiseRouter handles paths like '/', '/:userId', etc.
    // Typically you'd mount it with an API prefix, e.g. app.use('/api/franchise', franchiseRouter)
    // But in the source code, it looks like it's already configured under /api/franchise
    // For simplicity, let's just mount it at root here:
    app.use('/', franchiseRouter);
  });

  afterEach(() => {
    // Clear all mocks between tests to avoid shared state
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------
  // GET / (List all franchises) => franchiseRouter.get('/')
  // -------------------------------------------------------------
  describe('GET /', () => {
    it('should return a list of all franchises (no auth required)', async () => {
      const mockFranchises = [
        { id: 1, name: 'PizzaPocket' },
        { id: 2, name: 'BurgerPlace' },
      ];
      DB.getFranchises.mockResolvedValue(mockFranchises);

      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockFranchises);
      // The router calls: DB.getFranchises(req.user)
      // In this route, req.user might be undefined if no token
      // or a user object if there's a token. 
      // We didn't set any auth header, so it should pass `undefined`.
      expect(DB.getFranchises).toHaveBeenCalledWith(undefined);
    });
  });

  // -------------------------------------------------------------
  // GET /:userId (List user's franchises) => Protected route
  // -------------------------------------------------------------
  describe('GET /:userId', () => {
    it('should allow access if req.user is same user or an Admin', async () => {
      // We have mocked authenticateToken to set user.id = 1 with Admin role
      // userId param is "1", so that matches in the sense of "same user"
      // or admin anyway.

      const mockUserFranchises = [
        { id: 10, name: 'AdminPizza' },
      ];
      DB.getUserFranchises.mockResolvedValue(mockUserFranchises);

      const res = await request(app).get('/1'); // userId=1
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockUserFranchises);
      expect(DB.getUserFranchises).toHaveBeenCalledWith(1);
    });

    it('should return an empty array if user is not the same and not an Admin', async () => {
      // We'll override the default mock for authenticateToken
      // This time, let's pretend the user is not an Admin, user.id=2
      const { authRouter } = require('../routes/authRouter');
      authRouter.authenticateToken.mockImplementation((req, res, next) => {
        req.user = {
          id: 2,
          roles: [{ role: 'User' }],
          isRole(role) {
            return this.roles.some((r) => r.role === role);
          },
        };
        next();
      });

      // DB.getUserFranchises would only be called if user.id=the param or is Admin
      // In the code, if the condition fails, we do not call DB.getUserFranchises and return []
      const res = await request(app).get('/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]); // The router sets `result = []` if user doesn't match or isn't admin
      expect(DB.getUserFranchises).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------
  // POST / (Create a new franchise) => Protected route (Admin only)
  // -------------------------------------------------------------
  describe('POST /', () => {
    it('should create a new franchise if user is an Admin', async () => {
      // By default the user is an Admin from our mock
      const newFranchise = { name: 'NewFranchise' };
      const mockCreated = { id: 100, name: 'NewFranchise' };
      DB.createFranchise.mockResolvedValue(mockCreated);

      const res = await request(app).post('/').send(newFranchise);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockCreated);
      expect(DB.createFranchise).toHaveBeenCalledWith(newFranchise);
    });

    it('should return 403 if user is not an Admin', async () => {
      const { authRouter } = require('../routes/authRouter');
      authRouter.authenticateToken.mockImplementation((req, res, next) => {
        req.user = {
          id: 2,
          roles: [{ role: 'User' }], // not an Admin
          isRole(role) {
            return this.roles.some((r) => r.role === role);
          },
        };
        next();
      });

      const res = await request(app).post('/').send({ name: 'NopeFranchise' });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: 'unable to create a franchise',
      });
      expect(DB.createFranchise).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------
  // DELETE /:franchiseId => Protected route (Admin only)
  // -------------------------------------------------------------
  describe('DELETE /:franchiseId', () => {
    it('should delete a franchise if user is Admin', async () => {
      DB.deleteFranchise.mockResolvedValue();

      const res = await request(app).delete('/10'); // example ID
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'franchise deleted' });
      expect(DB.deleteFranchise).toHaveBeenCalledWith(10);
    });

    it('should return 403 if user is not an Admin', async () => {
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

      const res = await request(app).delete('/10');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: 'unable to delete a franchise',
      });
      expect(DB.deleteFranchise).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------
  // POST /:franchiseId/store => Protected route 
  //  - Admin or one of the franchise admins can create a store
  // -------------------------------------------------------------
  describe('POST /:franchiseId/store', () => {
    it('should allow Admin to create a store', async () => {
      // By default, user is Admin
      // We must mock DB.getFranchise to return a franchise with some admins
      DB.getFranchise.mockResolvedValue({
        id: 99,
        name: 'Test Franchise',
        admins: [{ id: 5, name: 'someone' }], // doesn't matter
      });
      const mockStore = { id: 500, name: 'New Store' };
      DB.createStore.mockResolvedValue(mockStore);

      const res = await request(app)
        .post('/99/store')
        .send({ name: 'New Store' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockStore);
      expect(DB.getFranchise).toHaveBeenCalledWith({ id: 99 });
      expect(DB.createStore).toHaveBeenCalledWith(99, { name: 'New Store' });
    });

    it('should allow non-Admin if user is in franchise admins', async () => {
      const { authRouter } = require('../routes/authRouter');
      authRouter.authenticateToken.mockImplementation((req, res, next) => {
        req.user = {
          id: 5,
          roles: [{ role: 'User' }], // not Admin
          isRole(role) {
            return this.roles.some((r) => r.role === role);
          },
        };
        next();
      });

      DB.getFranchise.mockResolvedValue({
        id: 99,
        name: 'Test Franchise',
        admins: [{ id: 5, name: 'John' }], // user.id=5 is in the admins
      });
      const mockStore = { id: 501, name: 'Store by NonAdmin' };
      DB.createStore.mockResolvedValue(mockStore);

      const res = await request(app)
        .post('/99/store')
        .send({ name: 'Store by NonAdmin' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockStore);
    });

    it('should return 403 if user is not an Admin nor a franchise admin', async () => {
      const { authRouter } = require('../routes/authRouter');
      authRouter.authenticateToken.mockImplementation((req, res, next) => {
        req.user = {
          id: 10,
          roles: [{ role: 'User' }], // not Admin
          isRole(role) {
            return this.roles.some((r) => r.role === role);
          },
        };
        next();
      });

      DB.getFranchise.mockResolvedValue({
        id: 99,
        name: 'Test Franchise',
        admins: [{ id: 5, name: 'some other user' }],
      });

      const res = await request(app)
        .post('/99/store')
        .send({ name: 'Unauthorized Store' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: 'unable to create a store',
      });
      expect(DB.createStore).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------
  // DELETE /:franchiseId/store/:storeId => Protected route 
  //  - Admin or one of the franchise admins can delete a store
  // -------------------------------------------------------------
  describe('DELETE /:franchiseId/store/:storeId', () => {
    it('should delete a store if user is Admin', async () => {
      DB.getFranchise.mockResolvedValue({
        id: 999,
        name: 'Test Franchise',
        admins: [],
      });

      const res = await request(app).delete('/999/store/123');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'store deleted' });
      expect(DB.deleteStore).toHaveBeenCalledWith(999, 123);
    });

    it('should return 403 if user not admin nor in franchise admins', async () => {
      const { authRouter } = require('../routes/authRouter');
      authRouter.authenticateToken.mockImplementation((req, res, next) => {
        req.user = {
          id: 10,
          roles: [{ role: 'User' }], // not Admin
          isRole(role) {
            return this.roles.some((r) => r.role === role);
          },
        };
        next();
      });

      DB.getFranchise.mockResolvedValue({
        id: 999,
        name: 'Test Franchise',
        admins: [{ id: 7 }], // user.id=10 is not in the admins
      });

      const res = await request(app).delete('/999/store/123');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: 'unable to delete a store',
      });
      expect(DB.deleteStore).not.toHaveBeenCalled();
    });
  });
});
