// Rename, or copy, to config.js in the same directory
exports.config = {
	db: {
		type: 'mongo',
		auth: {
			user: 'username',
			pass: 'password',
			host: 'your.host',
			port: 27017,
			db: 'mergeatron',
			slaveOk: true
		},
		database: 'mergeatron',
		collections: [ 'pulls', 'pushes' ]
	},
	log_level: 'info',
	plugin_dirs: [ './plugins/' ],
	plugins: {
		github: {
			method: 'hooks',    // 'hooks' for webhooks or 'polling' to poll the REST API
			auth: {
				type: 'basic',
				username: 'username',
				password: 'password'
			},
			user: 'user-to-watch',
			repos: [ 'repo_name' ],
			push_repos: {
			  "repo": [ /^master$/ ]
			},
			retry_whitelist: [ 'user', 'user2' ],    // optional whitelist of those able to trigger retries
			skip_file_listing: false,
			frequency: 15000,    // only necessary if method is 'polling'
			port: '8888',        // only necessary if method is 'hooks'
			// optional. If running GitHub Enterprise this is the host/port to access the REST API.
			// Can be left out if just using github.com.
			api: {
				host: 'ghe.example.com',
				port: '1234'
			}
		},
		jenkins:  {
			user: false,
			pass: false,
			protocol: 'http',
			token: 'token_to_remote_trigger_all_jobs',
			host: 'jenkins.yoururl.com:8080',
			push_projects: [
			    REPO_NAME: {
			        project: 'project_name',
			        rules: [
			            // array of RegExps
			        ],
			        token: 'special_token_just_for_this_job'
			    }
			],
			projects: [{
				name: 'project_name',
				repo: 'repo_name',
				token: 'special_token_just_for_this_job',
				rules: [ /.php/g ]
			}],
			default_project: {
				name: 'default_project_name',
				token: 'token'
			},
			frequency: 2000
		},
		phpcs: {
			enabled: false,
			artifact: 'artifacts/phpcs.csv'
		},
		phpunit: {
			enabled: false,
			artifact: 'artifacts/junit.xml',
			failure_limit: 3
		}
	}
};
