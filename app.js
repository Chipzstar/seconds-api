require("dotenv").config();
const express = require("express");
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jobRoutes = require('./routes/jobs');
const { genApiKey } = require("./helpers/helpers");
const port = 3001;

// defining the Express app
const app = express();
app.set('port', process.env.PORT || port);

// adding Helmet to enhance your API's security
app.use(helmet());

	// using bodyParser to parse JSON bodies into JS objects
app.use(bodyParser.json());

// enabling CORS for all requests
app.use(cors());

// adding morgan to log HTTP requests
app.use(morgan('combined'));

// defining an endpoint to return a welcome message
app.get('/', (req, res) => {
	res.send("WELCOME TO SECONDS API");
});

app.use('/api/v1/jobs', jobRoutes);

// starting the server
app.listen(port, () => {
	console.log(`listening on port ${port}`);
});
