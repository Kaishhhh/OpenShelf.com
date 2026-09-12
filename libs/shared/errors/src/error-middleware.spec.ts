import { errorMiddleware } from './error-middleware.js';
import { ValidationError } from './index.js';

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('errorMiddleware', () => {
  it('surfaces an AppError message and status', () => {
    const res = mockRes();
    errorMiddleware(new ValidationError('Bad email'), {} as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Bad email' })
    );
  });

  it('hides the message of a non-AppError', () => {
    const res = mockRes();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    errorMiddleware(new Error('connection string leaked'), {} as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Something went wrong' })
    );
  });
});