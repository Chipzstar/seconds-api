const mongoose = require('mongoose')

mongoose.set("debug", false);
mongoose.Promise = Promise;

mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/seconds", {
	keepAlive: true,
	useNewUrlParser: true,
	useUnifiedTopology: true
}, (error) => {
	if (error) console.log(error)
	else console.log("Connected to Mongo Database!")
})

module.exports.User = require("./user");
module.exports.Job = require("./job");