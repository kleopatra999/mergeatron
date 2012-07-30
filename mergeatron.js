var GitHubApi = require('github'),
	mongo = require('mongojs').connect('mergeatron', ['pulls', 'jobs']),
	request = require('request'),
	url = require('url'),
	uuid = require('node-uuid'),
	async = require('async'),
	config = require('./config').config;

var GitHub = new GitHubApi({
		version: '3.0.0'
	});

GitHub.authenticate({
	type: 'basic',
	username: config.github.auth.user,
	password: config.github.auth.pass
});

async.parallel({
	'github': function() {
		var run_github = function() {
			GitHub.pullRequests.getAll({ 'user': config.github.user, 'repo': config.github.repo, 'state': 'open' }, function(error, resp) {
				if (error) {
					console.log(error);
					return;
				}

				for (i in resp) {
					var pull = resp[i],
						number = pull.number;

					if (!number || number == 'undefined') {
						continue;
					}

					if (pull.body.indexOf('@' + config.github.user + ' ignore') != -1) {
						continue;
					}

					processPull(pull);
				}
			});

			setTimeout(run_github, config.github.frequency);
		};

		run_github();
	},

	'jenkins': function() {
		var run_jenkins = function() {
			mongo.jobs.find({ status: { $ne: 'finished' } }).forEach(function(error, item) {
				if (!item) { return; }
				checkJob(item['_id']);
			});

			setTimeout(run_jenkins, config.jenkins.frequency);
		};

		run_jenkins();
	}
});

function processPull(pull) {
	mongo.pulls.findOne({ _id: pull.number }, function(error, item) {
		var new_pull = false,
			ssh_url = pull.head.repo.ssh_url,
			branch = 'origin/' + pull.head.label.split(':')[1];

		if (!item) {
			new_pull = true;
			mongo.pulls.insert({ _id: pull.number, created_at: pull.created_at, updated_at: pull.updated_at, head: pull.head.sha });
		}

		if (new_pull || pull.head.sha != item.head) {
			buildPull(pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
			return;
		}

		GitHub.issues.getComments({ user: config.github.user, repo: config.github.repo, number: pull.number, per_page: 100 }, function(error, resp) {
			for (i in resp) {
				if (resp[i].created_at > item.updated_at && resp[i].body.indexOf('@' + config.github.user + ' retest') != -1) {
					comment(pull.number, 'Got it @' + resp[i].user.login + '. Queueing up a new build.');
					buildPull(pull.number, pull.head.sha, ssh_url, branch, pull.updated_at);
					return;
				}
			}
		});
	});
}

function buildPull(number, sha, ssh_url, branch, updated_at) {
	var job_id = uuid.v1(),
		options = {
		url: url.format({
			protocol: config.jenkins.protocol,
			host: config.jenkins.host,
			pathname: '/job/' + config.jenkins.project + '/buildWithParameters',
			query: {
				token: config.jenkins.token,
				cause: 'Testing Pull Request: ' + number,
				REPOSITORY_URL: ssh_url,
				BRANCH_NAME: branch,
				JOB: job_id,
				PULL: number
			}
		}),
		method: 'GET',
	};

	request(options, function(error, response, body) {
		if (error) {
			console.log(error);
			return;
		}

		mongo.pulls.update({ _id: number }, { $set: { head: sha, updated_at: updated_at } });
		mongo.jobs.insert({ _id: job_id, pull: number, status: 'new' });

		checkJob(job_id);
	});
}

function checkJob(job_id) {
	var options = {
		url: url.format({
			protocol: config.jenkins.protocol,
			host: config.jenkins.host,
			pathname: '/job/' + config.jenkins.project + '/api/json',
			query: {
				tree: 'builds[number,url,actions[parameters[name,value]],building,result]'
			},
		}),
		json: true
	};

	request(options, function(error, response) {
		response.body.builds.forEach(function(build) {
			if (typeof build.actions[0].parameters == undefined || !build.actions[0].parameters) {
				return;
			}

			build.actions[0].parameters.forEach(function(param) {
				if (param['name'] == 'JOB' && param['value'] == job_id) {
					mongo.jobs.findOne({ _id: job_id }, function(error, job) {
						if (job['status'] == 'new') {
							comment(job['pull'], "Testing Pull Request\nBuild: " + build['url']);
							mongo.jobs.update({ _id: job_id }, { $set: { status: 'started' } });
						}

						if (job['status'] != 'finished') {
							if (build['result'] == 'FAILURE') {
								comment(job['pull'], ":-1: Defeated\n" + build['url'] + '/console');
								mongo.jobs.update({ _id: job_id }, { $set: { status: 'finished' } });
							} else if (build['result'] == 'SUCCESS') {
								comment(job['pull'], ':+1: Victory!');
								mongo.jobs.update({ _id: job_id }, { $set: { status: 'finished' } });
							}
						}
					});
				}
			});
		});
	});
}

function comment(pull_number, comment) {
	GitHub.issues.createComment({ user: config.github.user, repo: config.github.repo, number: pull_number, body: comment });
}