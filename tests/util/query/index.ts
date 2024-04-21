import axios, { AxiosError } from 'axios';

export class GraphQLClient {
	constructor(private url: string) {}

	public queryGql = async (query: string) => {
		try {
			const res = await axios.post(
				this.url,
				JSON.stringify({
					query: query,
					variables: {},
				}),
				{
					headers: {
						accept: 'application/graphql-response+json, application/json',
						'content-type': 'application/json',
					},
				},
			);

			return res.data;
		} catch (e) {
			const err = e as AxiosError<any>;

			console.warn(err.status, err.response?.data.errors);
			return err.response?.data;
		}
	};
}
