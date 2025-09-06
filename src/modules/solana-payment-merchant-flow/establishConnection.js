const { clusterApiUrl, Connection } = require('@solana/web3.js');

/**
 * Establish a connection to the cluster
 */
 async function establishConnection(cluster = 'devnet') {
    const endpoint = clusterApiUrl(cluster);
    const connection = new Connection(endpoint, 'confirmed');
    const version = await connection.getVersion();
    console.log('Connection to cluster established:', endpoint, version);

    return connection;
}
module.exports={
    establishConnection
}