const mongoose = require('mongoose')
const { userSchema, driverSchema, jobSchema, catalogSchema, settingsSchema, hubriseSchema } = require('@seconds-technologies/database_schemas');

mongoose.set("debug", false);
mongoose.Promise = Promise;

mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/seconds", {
	keepAlive: true
}, (error) => {
	if (error) console.log(error)
	else console.log("Connected to Mongo Database!")
})

module.exports.User = mongoose.model('User', userSchema);
module.exports.Job = mongoose.model('Job', jobSchema);
module.exports.Webhook = require("./webhook");
module.exports.Catalog = mongoose.model('Catalog', catalogSchema);
module.exports.Driver = mongoose.model('Driver', driverSchema);
module.exports.Settings = mongoose.model('Settings', settingsSchema);
module.exports.Hubrise = mongoose.model('Hubrise', hubriseSchema);