const express = require('express');
const router = express.Router();
const Docker = require('dockerode');
const docker = new Docker();
const getPort = require("get-port");
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cookie = require('cookie-parser');

// Initialize cookie parser middleware
router.use(cookie());

// Store active containers and their ports
const activeContainers = new Map();

// Periodic cleanup of expired containers
setInterval(() => {
  const now = Date.now();
  for (const [containerId, containerInfo] of activeContainers.entries()) {
    if (now - containerInfo.createdAt > 3600 * 1000) {
      console.log('Cleaning up expired container:', containerId);
      containerInfo.container.remove({ force: true })
        .then(() => console.log('Container removed during cleanup:', containerId))
        .catch((err) => console.error('Error removing container during cleanup:', err));
      activeContainers.delete(containerId);
    }
  }
}, 60000); // Check every minute

// Helper function to create a container
async function createFirefoxContainer() {
  // Get random available ports for the container
  const randomPort1 = await getPort(); // Random port for 3000
  const randomPort2 = await getPort(); // Random port for 3001
  
  // Define the Docker container configuration
  const containerConfig = {
    Image: 'lscr.io/linuxserver/firefox:latest',
    Env: [
      'PUID=1000',
      'PGID=1000',
      'TZ=Etc/UTC',
    ],
    ShmSize: 1073741824, // 1GB in bytes
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
  const containerId = container.id;
  console.log('Container created successfully:', containerId);
  
  // Start the container
  await container.start();
  console.log('Container started');
  
  // Store container information
  activeContainers.set(containerId, {
    container: container,
    port1: randomPort1,
    port2: randomPort2,
    createdAt: Date.now()
  });
  
  // Set a timeout to remove the container after 1 hour (3600 seconds)
  setTimeout(() => {
    console.log('Removing container after 1 hour:', containerId);
    container.remove({ force: true })
      .then(data => {
        console.log('Container removed:', data);
        activeContainers.delete(containerId);
      })
      .catch(err => console.error('Error removing container:', err));
  }, 3600 * 1000); // 1 hour in milliseconds
  
  return containerId;
}

// Function to render the Firefox UI
function renderFirefoxUI(containerId) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Firefox Remote Instance</title>
      <style>
        body, html {
          margin: 0;
          padding: 0;
          height: 100%;
          overflow: hidden;
        }
        .container {
          display: flex;
          flex-direction: column;
          height: 100vh;
        }
        iframe {
          flex: 1;
          width: 100%;
          border: none;
        }
        .info {
          background: #f0f0f0;
          padding: 10px;
          font-family: Arial, sans-serif;
          display: flex;
          justify-content: space-between;
        }
        .session-id {
          font-size: 0.8em;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="info">
          <div>Firefox container session (expires in 1 hour)</div>
          <div class="session-id">Session ID: ${containerId.substring(0, 8)}</div>
        </div>
        <iframe src="/firefox/proxy/${containerId}/3000" allowfullscreen></iframe>
      </div>
      <script>
        // Add session tracking logic if needed
        console.log("Firefox session started with ID: ${containerId}");
        
        // Poll for container status every 30 seconds
        const statusCheck = setInterval(() => {
          fetch('/firefox/status/${containerId}')
            .then(response => response.json())
            .then(data => {
              if (data.status !== 'running') {
                clearInterval(statusCheck);
                alert('Your Firefox session has expired. Please refresh for a new session.');
              }
            })
            .catch(err => console.error('Error checking status:', err));
        }, 30000);
      </script>
    </body>
    </html>
  `;
}

// Single route handling all firefox-related requests
router.all('*', async function(req, res, next) {
  try {
    const path = req.path;
    
    // Handle proxy requests
    if (path.startsWith('/proxy/')) {
      const pathParts = path.split('/');
      const containerId = pathParts[2];
      const port = pathParts[3];
      
      if (!activeContainers.has(containerId)) {
        return res.status(404).send('Container not found');
      }
      
      const containerInfo = activeContainers.get(containerId);
      const targetPort = port === '3000' ? containerInfo.port1 : containerInfo.port2;
      
      return createProxyMiddleware({
        target: `http://localhost:${targetPort}`,
        changeOrigin: true,
        ws: true,
        pathRewrite: function (path) {
          return path.replace(`/proxy/${containerId}/${port}`, '');
        },
        onError: (err, req, res) => {
          console.error('Proxy error:', err);
          res.status(502).send('Proxy error');
        }
      })(req, res, next);
    }
    
    // Handle status requests
    else if (path.startsWith('/status/')) {
      const containerId = path.split('/')[2];
      
      if (activeContainers.has(containerId)) {
        const containerInfo = activeContainers.get(containerId);
        const elapsedTime = Math.floor((Date.now() - containerInfo.createdAt) / 1000);
        const remainingTime = Math.max(0, 3600 - elapsedTime);
        
        return res.json({
          status: 'running',
          remainingTime: remainingTime,
          ports: {
            port1: containerInfo.port1,
            port2: containerInfo.port2
          }
        });
      } else {
        return res.status(404).json({ status: 'not_found' });
      }
    }
    

module.exports = router;