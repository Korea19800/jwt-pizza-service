const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const config = require('../config.js');
const { StatusCodeError } = require('../endpointHelper.js');
const { Role } = require('../model/model.js');
const dbModel = require('./dbModel.js');
const logger = require('../logging/logger.js');

/* eslint-disable no-unused-vars */

class DB {
  constructor() {
    this.pool = null;
    this.initialized = this.initializeDatabase();
  }

  // Create a new connection pool
  createPool() {
    if (this.pool) {
      return this.pool;
    }
    
    this.pool = mysql.createPool({
      host: config.db.connection.host,
      user: config.db.connection.user,
      password: config.db.connection.password,
      database: config.db.connection.database,
      connectTimeout: config.db.connection.connectTimeout,
      decimalNumbers: true,
      waitForConnections: true,
      connectionLimit: 10, // Limit the number of connections
      queueLimit: 0,
    });
    
    return this.pool;
  }

  async getMenu() {
    return this.withConnection(async (connection) => {
      return await this.query(connection, `SELECT * FROM menu`);
    });
  }

  async addMenuItem(item) {
    return this.withConnection(async (connection) => {
      const addResult = await this.query(connection, `INSERT INTO menu (title, description, image, price) VALUES (?, ?, ?, ?)`, 
        [item.title, item.description, item.image, item.price]);
      return { ...item, id: addResult.insertId };
    });
  }

  async addUser(user) {
    return this.withConnection(async (connection) => {
      const hashedPassword = await bcrypt.hash(user.password, 10);

      const userResult = await this.query(connection, `INSERT INTO user (name, email, password) VALUES (?, ?, ?)`, 
        [user.name, user.email, hashedPassword]);
      const userId = userResult.insertId;
      for (const role of user.roles) {
        switch (role.role) {
          case Role.Franchisee: {
            const franchiseId = await this.getID(connection, 'name', role.object, 'franchise');
            await this.query(connection, `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`, 
              [userId, role.role, franchiseId]);
            break;
          }
          default: {
            await this.query(connection, `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`, 
              [userId, role.role, 0]);
            break;
          }
        }
      }
      return { ...user, id: userId, password: undefined };
    });
  }

  async getUser(email, password) {
    return this.withConnection(async (connection) => {
      const userResult = await this.query(connection, `SELECT * FROM user WHERE email=?`, [email]);
      const user = userResult[0];
      if (!user || !(await bcrypt.compare(password, user.password))) {
        throw new StatusCodeError('unknown user', 404);
      }

      const roleResult = await this.query(connection, `SELECT * FROM userRole WHERE userId=?`, [user.id]);
      const roles = roleResult.map((r) => {
        return { objectId: r.objectId || undefined, role: r.role };
      });

      return { ...user, roles: roles, password: undefined };
    });
  }

  async updateUser(userId, email, password) {
    return this.withConnection(async (connection) => {
      const params = [];
      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        params.push(`password='${hashedPassword}'`);
      }
      if (email) {
        params.push(`email='${email}'`);
      }
      if (params.length > 0) {
        const query = `UPDATE user SET ${params.join(', ')} WHERE id=${userId}`;
        await this.query(connection, query);
      }
      return this.getUser(email, password);
    });
  }

  async loginUser(userId, token) {
    token = this.getTokenSignature(token);
    return this.withConnection(async (connection) => {
      await this.query(connection, `INSERT INTO auth (token, userId) VALUES (?, ?)`, [token, userId]);
    });
  }

  async isLoggedIn(token) {
    token = this.getTokenSignature(token);
    return this.withConnection(async (connection) => {
      const authResult = await this.query(connection, `SELECT userId FROM auth WHERE token=?`, [token]);
      return authResult.length > 0;
    });
  }

  async logoutUser(token) {
    token = this.getTokenSignature(token);
    return this.withConnection(async (connection) => {
      await this.query(connection, `DELETE FROM auth WHERE token=?`, [token]);
    });
  }

  async getOrders(user, page = 1) {
    return this.withConnection(async (connection) => {
      const offset = this.getOffset(page, config.db.listPerPage);
      const orders = await this.query(connection, `SELECT id, franchiseId, storeId, date FROM dinerOrder WHERE dinerId=? LIMIT ${offset},${config.db.listPerPage}`, [user.id]);
      for (const order of orders) {
        let items = await this.query(connection, `SELECT id, menuId, description, price FROM orderItem WHERE orderId=?`, [order.id]);
        order.items = items;
      }
      return { dinerId: user.id, orders: orders, page };
    });
  }

  async addDinerOrder(user, order) {
    return this.withConnection(async (connection) => {
      const orderResult = await this.query(connection, `INSERT INTO dinerOrder (dinerId, franchiseId, storeId, date) VALUES (?, ?, ?, now())`, [user.id, order.franchiseId, order.storeId]);
      const orderId = orderResult.insertId;
      for (const item of order.items) {
        const menuId = await this.getID(connection, 'id', item.menuId, 'menu');
        await this.query(connection, `INSERT INTO orderItem (orderId, menuId, description, price) VALUES (?, ?, ?, ?)`, [orderId, menuId, item.description, item.price]);
      }
      return { ...order, id: orderId };
    });
  }

  async createFranchise(franchise) {
    return this.withConnection(async (connection) => {
      for (const admin of franchise.admins) {
        const adminUser = await this.query(connection, `SELECT id, name FROM user WHERE email=?`, [admin.email]);
        if (adminUser.length == 0) {
          throw new StatusCodeError(`unknown user for franchise admin ${admin.email} provided`, 404);
        }
        admin.id = adminUser[0].id;
        admin.name = adminUser[0].name;
      }

      const franchiseResult = await this.query(connection, `INSERT INTO franchise (name) VALUES (?)`, [franchise.name]);
      franchise.id = franchiseResult.insertId;

      for (const admin of franchise.admins) {
        await this.query(connection, `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`, [admin.id, Role.Franchisee, franchise.id]);
      }

      return franchise;
    });
  }

  async deleteFranchise(franchiseId) {
    return this.withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        await this.query(connection, `DELETE FROM store WHERE franchiseId=?`, [franchiseId]);
        await this.query(connection, `DELETE FROM userRole WHERE objectId=?`, [franchiseId]);
        await this.query(connection, `DELETE FROM franchise WHERE id=?`, [franchiseId]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw new StatusCodeError('unable to delete franchise', 500);
      }
    });
  }

  async getFranchises(authUser) {
    return this.withConnection(async (connection) => {
      const franchises = await this.query(connection, `SELECT id, name FROM franchise`);
      for (const franchise of franchises) {
        if (authUser?.isRole(Role.Admin)) {
          await this.getFranchise(franchise);
        } else {
          franchise.stores = await this.query(connection, `SELECT id, name FROM store WHERE franchiseId=?`, [franchise.id]);
        }
      }
      return franchises;
    });
  }

  async getUserFranchises(userId) {
    return this.withConnection(async (connection) => {
      let franchiseIds = await this.query(connection, `SELECT objectId FROM userRole WHERE role='franchisee' AND userId=?`, [userId]);
      if (franchiseIds.length === 0) {
        return [];
      }

      franchiseIds = franchiseIds.map((v) => v.objectId);
      const franchises = await this.query(connection, `SELECT id, name FROM franchise WHERE id in (${franchiseIds.join(',')})`);
      for (const franchise of franchises) {
        await this.getFranchise(franchise);
      }
      return franchises;
    });
  }

  async getFranchise(franchise) {
    return this.withConnection(async (connection) => {
      franchise.admins = await this.query(connection, `SELECT u.id, u.name, u.email FROM userRole AS ur JOIN user AS u ON u.id=ur.userId WHERE ur.objectId=? AND ur.role='franchisee'`, [franchise.id]);

      franchise.stores = await this.query(
        connection,
        `SELECT s.id, s.name, COALESCE(SUM(oi.price), 0) AS totalRevenue FROM dinerOrder AS do JOIN orderItem AS oi ON do.id=oi.orderId RIGHT JOIN store AS s ON s.id=do.storeId WHERE s.franchiseId=? GROUP BY s.id`,
        [franchise.id]
      );

      return franchise;
    });
  }

  async createStore(franchiseId, store) {
    return this.withConnection(async (connection) => {
      const insertResult = await this.query(connection, `INSERT INTO store (franchiseId, name) VALUES (?, ?)`, [franchiseId, store.name]);
      return { id: insertResult.insertId, franchiseId, name: store.name };
    });
  }

  async deleteStore(franchiseId, storeId) {
    return this.withConnection(async (connection) => {
      await this.query(connection, `DELETE FROM store WHERE franchiseId=? AND id=?`, [franchiseId, storeId]);
    });
  }

  getOffset(currentPage = 1, listPerPage) {
    return (currentPage - 1) * [listPerPage];
  }

  getTokenSignature(token) {
    const parts = token.split('.');
    if (parts.length > 2) {
      return parts[2];
    }
    return '';
  }

  // Helper method to safely execute queries with a connection from the pool
  async withConnection(callback) {
    // Ensure the pool is created and initialized
    await this.initialized;
    const pool = this.createPool();
    
    // Get a connection from the pool
    const connection = await pool.getConnection();
    
    try {
      // Execute the callback with the connection
      return await callback(connection);
    } finally {
      // Always return connection to pool when done
      connection.release();
    }
  }

  async query(connection, sql, params) {
    try {
      const logCallback = logger.dbLogger(sql, params);
      const [rows] = await connection.execute(sql, params);
      logCallback(null, rows);
      return rows;
    } catch (error) {
      logger.dbLogger(sql, params)(error, null);
      throw error;
    }
  }

  async getID(connection, key, value, table) {
    const [rows] = await connection.execute(`SELECT id FROM ${table} WHERE ${key}=?`, [value]);
    if (rows.length > 0) {
      return rows[0].id;
    }
    throw new Error('No ID found');
  }

  async initializeDatabase() {
    try {
      // Create a temporary connection for initialization
      const connection = await mysql.createConnection({
        host: config.db.connection.host,
        user: config.db.connection.user,
        password: config.db.connection.password,
        connectTimeout: config.db.connection.connectTimeout,
        decimalNumbers: true,
      });

      try {
        const dbExists = await this.checkDatabaseExists(connection);
        console.log(dbExists ? 'Database exists' : 'Database does not exist, creating it');

        await connection.query(`CREATE DATABASE IF NOT EXISTS ${config.db.connection.database}`);
        await connection.query(`USE ${config.db.connection.database}`);

        if (!dbExists) {
          console.log('Successfully created database');
        }

        for (const statement of dbModel.tableCreateStatements) {
          await connection.query(statement);
        }
        /* 아래는 수정전
        if (!dbExists) {
          const defaultAdmin = { name: '常用名字', email: 'a@jwt.com', password: 'admin', roles: [{ role: Role.Admin }] };
          await this.addUser(defaultAdmin);
        }
        */
        if (!dbExists) {
          const defaultAdmin = {
            name: "常用名字",
            email: "a@jwt.com",
            password: "admin",
            roles: [{ role: Role.Admin }],
          };
          this.addUser(defaultAdmin);
        }
      } finally {
        await connection.end();
      }
    } catch (err) {
      console.error(JSON.stringify({ message: 'Error initializing database', exception: err.message, connection: config.db.connection }));
    }
  }

  async checkDatabaseExists(connection) {
    const [rows] = await connection.execute(`SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`, [config.db.connection.database]);
    return rows.length > 0;
  }
}

const db = new DB();
module.exports = { Role, DB: db };
