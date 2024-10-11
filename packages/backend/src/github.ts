import { Octokit } from "@octokit/rest";
import { GitHubConfig } from "./schemas/v2.js";
import { createLogger } from "./logger.js";
import { AppContext, Repository } from "./types.js";
import path from 'path';

const logger = createLogger("GitHub");

type OctokitRepository = {
    name: string,
    full_name: string,
    fork: boolean,
    private: boolean,
    html_url: string,
    clone_url?: string,
    stargazers_count?: number,
    watchers_count?: number,
    subscribers_count?: number,
    forks_count?: number,
    archived?: boolean,
}

export const getGitHubReposFromConfig = async (config: GitHubConfig, signal: AbortSignal, ctx: AppContext) => {
    const octokit = new Octokit({
        auth: config.token,
        ...(config.url ? [{
            baseUrl: `${config.url}/api/v3`
        }] : []),
    });

    let allRepos: OctokitRepository[] = [];

    if (config.orgs) {
        const _repos = await getReposForOrgs(config.orgs, octokit, signal);
        allRepos = allRepos.concat(_repos);
    }

    if (config.repos) {
        const _repos = await getRepos(config.repos, octokit, signal);
        allRepos = allRepos.concat(_repos);
    }

    if (config.users) {
        const isAuthenticated = config.token !== undefined;
        const _repos = await getReposOwnedByUsers(config.users, isAuthenticated, octokit, signal);
        allRepos = allRepos.concat(_repos);
    }

    // Marshall results to our type
    const repos: Repository[] = allRepos
        .filter((repo) => {
            if (!repo.clone_url) {
                logger.warn(`Repository ${repo.name} missing property 'clone_url'. Excluding.`)
                return false;
            }
            return true;
        })
        .map((repo) => {
            const hostname = config.url ? new URL(config.url).hostname : 'github.com';
            const fullName = `${hostname}/${repo.full_name}`;
            const repoPath = path.resolve(path.join(ctx.reposPath, `${fullName}.git`));

            const cloneUrl = new URL(repo.clone_url!);
            if (config.token) {
                cloneUrl.username = config.token;
            }
            
            return {
                name: repo.name,
                fullName,
                cloneUrl: cloneUrl.toString(),
                path: repoPath,
                stale: false,
                gitConfigMetadata: {
                    'zoek.web-url-type': 'github',
                    'zoekt.web-url': repo.html_url,
                    'zoekt.name': fullName,
                    'zoekt.github-stars': (repo.stargazers_count ?? 0).toString(),
                    'zoekt.github-watchers': (repo.watchers_count ?? 0).toString(),
                    'zoekt.github-subscribers': (repo.subscribers_count ?? 0).toString(),
                    'zoekt.github-forks': (repo.forks_count ?? 0).toString(),
                    'zoekt.archived': (repo.archived ?? false) ? '1' : '0',
                    'zoekt.fork': repo.fork ? '1' : '0',
                    'zoekt.public': repo.private === false ? '1' : '0'
                }
            }
        });

    // De-duplicate on fullname
    repos.sort((a, b) => {
        return a.fullName.localeCompare(b.fullName);
    });
    const uniqueRepos = repos.filter((item, index, self) => {
        if (index === 0) return true;
        return item.fullName !== self[index - 1].fullName;
    });

    logger.debug(`Found ${uniqueRepos.length} unique repositories.`);
    
    return uniqueRepos;
}

const getReposOwnedByUsers = async (users: string[], isAuthenticated: boolean, octokit: Octokit, signal: AbortSignal) => {
    // @todo : error handling
    const repos = (await Promise.all(users.map(async (user) => {
        logger.debug(`Fetching repository info for user ${user}...`);
        const start = Date.now();

        const result = await (() => {
            if (isAuthenticated) {
                return octokit.paginate(octokit.repos.listForAuthenticatedUser, {
                    username: user,
                    visibility: 'all',
                    affiliation: 'owner',
                    per_page: 100,
                    request: {
                        signal,
                    },
                });
            } else {
                return octokit.paginate(octokit.repos.listForUser, {
                    username: user,
                    per_page: 100,
                    request: {
                        signal,
                    },
                });
            }
        })();

        const duration = Date.now() - start;
        logger.debug(`Found ${result.length} owned by user ${user} in ${duration}ms.`);

        return result;
    }))).flat();

    return repos;
}

const getReposForOrgs = async (orgs: string[], octokit: Octokit, signal: AbortSignal) => {
    // @todo : error handling
    const repos = (await Promise.all(orgs.map(async (org) => {
        logger.debug(`Fetching repository info for org ${org}...`);
        const start = Date.now();

        const result = await octokit.paginate(octokit.repos.listForOrg, {
            org: org,
            per_page: 100,
            request: {
                signal
            }
        });

        const duration = Date.now() - start;
        logger.debug(`Found ${result.length} in org ${org} in ${duration}ms.`);

        return result;
    }))).flat();

    return repos;
}

const getRepos = async (repoList: string[], octokit: Octokit, signal: AbortSignal) => {
    // @todo : error handling
    const repos = await Promise.all(repoList.map(async (repo) => {
        logger.debug(`Fetching repository info for ${repo}...`);
        const start = Date.now();

        const [owner, repoName] = repo.split('/');
        const result = await octokit.repos.get({
            owner,
            repo: repoName,
            request: {
                signal
            }
        });

        const duration = Date.now() - start;
        logger.debug(`Found info for repository ${repo} in ${duration}ms`);

        return result.data;
    }));

    return repos;
}