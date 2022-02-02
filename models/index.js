const mongoose = require('mongoose')
const catalogSchema = require('@seconds-technologies/database_schemas')

mongoose.set("debug", false);
mongoose.Promise = Promise;

mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/seconds", {
	keepAlive: true
}, (error) => {
	if (error) console.log(error)
	else console.log("Connected to Mongo Database!")
})

module.exports.User = require("./user");
module.exports.Job = require("./job");
module.exports.Webhook = require("./webhook");
module.exports.Catalog = mongoose.model('Catalog', catalogSchema);