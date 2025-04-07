const { DB } = require('./database/database.js');

// made this file to change to admin role
async function cleanTokens() {
    try {
        await DB.withConnection(async (connection) => {
            console.log('Deleting all tokens from auth table...');
            await DB.query(connection, `DELETE FROM auth`);
            console.log('Successfully cleaned all tokens. Please log in again.');
        });
    } catch (err) {
        console.error('Error cleaning tokens:', err);
        console.error('Error details:', err.stack);
    }
    process.exit(0);
}

cleanTokens(); 