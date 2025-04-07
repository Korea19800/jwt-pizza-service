const { Role, DB } = require('./database/database.js');
const config = require('./config.js');

// made this file to change to admin role

// 연결 설정 출력
console.log('Database connection config:', {
    host: config.db.connection.host,
    user: config.db.connection.user,
    database: config.db.connection.database
});

async function updateUserRole(email) {
    try {
        console.log(`Attempting to update role for user: ${email}`);
        
        await DB.withConnection(async (connection) => {
            // 1. Get user ID
            console.log('Querying for user ID...');
            const userResult = await DB.query(connection, `SELECT id FROM user WHERE email=?`, [email]);
            if (userResult.length === 0) {
                console.error('User not found');
                return;
            }
            const userId = userResult[0].id;
            console.log(`Found user with ID: ${userId}`);

            // 2. Check current roles
            const currentRoles = await DB.query(connection, `SELECT * FROM userRole WHERE userId=?`, [userId]);
            console.log('Current roles:', currentRoles);

            // 3. Delete existing role
            console.log('Deleting existing roles...');
            await DB.query(connection, `DELETE FROM userRole WHERE userId=?`, [userId]);

            // 4. Add admin role
            console.log('Adding admin role...');
            await DB.query(connection, `INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)`, 
                [userId, Role.Admin, 0]);
            
            // 5. Verify the change
            const newRoles = await DB.query(connection, `SELECT * FROM userRole WHERE userId=?`, [userId]);
            console.log('New roles after update:', newRoles);
            
            console.log('Successfully updated user role to admin');
        });
    } catch (err) {
        console.error('Error updating role:', err);
        console.error('Error details:', err.stack);
    }
    process.exit(0);
}

// Update role for a@jwt.com
updateUserRole('a@jwt.com'); 