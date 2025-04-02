var express = require('express');
var router = express.Router();
const Docker = require('dockerode');
const docker = new Docker();
const getPort = require("get-port");
const path = require('path');


// GET route to start the container
router.get('/', async function(req, res, next) {
  try {
    // Get random available ports for the container
    const randomPort1 = await getPort(); // Random port for 3000
    const randomPort2 = await getPort(); // Random port for 3001

    // Define the Docker container configuration within the route handler
    const containerConfig = {
      Image: 'lscr.io/linuxserver/firefox:latest', 
      Env: [
        'PUID=1000',
        'PGID=1000',
        'TZ=Etc/UTC',
      ],
      ShmSize: 1073741824, // 1GB in bytes
      RestartPolicy: { Name: 'unless-stopped' },
      HostConfig: {
        PortBindings: {
          '3000/tcp': [{ HostPort: `${randomPort1}` }],
          '3001/tcp': [{ HostPort: `${randomPort2}` }]
        },
        Dns: ['94.140.14.14','1.1.1.1'], // Specify DNS server here
        Binds: [
          path.join(__dirname, 'custom-cont-init.d') + ':/custom-cont-init.d:ro',
        ],
    
      }
    };
    
    // Create and start the container
    const container = await docker.createContainer(containerConfig);
    console.log('Container created successfully');

    // Start the container
    await container.start();
    console.log('Container started');

    // Set a timeout to remove the container after 1 hour (3600 seconds)
    setTimeout(() => {
      console.log('Removing container after 1 hour');
      container.remove({ force: true }, (err, data) => {
        if (err) {
          console.error('Error removing container:', err);
        } else {
          console.log('Container removed:', data);
        }
      });
    }, 3600 * 1000); // 1 hour in milliseconds

    // Send a response back to the client
    res.send(`Container started with random ports: ${randomPort2} and ${randomPort1}. It will be removed in 1 hour.`);
  } catch (err) {
    console.error('Error starting container:', err);
    res.status(500).send('Error starting container');
  }
});

module.exports = router;
