// =============================================
// useAuth Custom Hook — ShopVerse
// =============================================

import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '@/store';
import { setUser, clearUser, setLoading } from '@/store/slices/authSlice';
import api from '@/services/api';
import { ILoginCredentials, IRegisterData } from '@shopverse/shared';
import { toast } from 'sonner';
import { useCallback } from 'react';

export const useAuth = () => {
  const dispatch = useDispatch();
  const { user, isAuthenticated, isLoading } = useSelector(
    (state: RootState) => state.auth
  );

  /**
   * Log in user with credentials.
   */
  const login = useCallback(
    async (credentials: ILoginCredentials) => {
      dispatch(setLoading(true));
      try {
        const response = await api.post('/auth/login', credentials);
        const { user: loggedInUser } = response.data.data;
        dispatch(setUser(loggedInUser));
        toast.success(`Welcome back, ${loggedInUser.firstName}!`);
        return loggedInUser;
      } catch (error: any) {
        dispatch(clearUser());
        const message = error.response?.data?.message || 'Login failed';
        toast.error(message);
        throw error;
      }
    },
    [dispatch]
  );

  /**
   * Register a new user profile.
   */
  const register = useCallback(
    async (registerData: IRegisterData) => {
      dispatch(setLoading(true));
      try {
        const response = await api.post('/auth/register', registerData);
        const { user: registeredUser } = response.data.data;
        dispatch(setUser(registeredUser));
        toast.success(`Welcome to ShopVerse, ${registeredUser.firstName}!`);
        return registeredUser;
      } catch (error: any) {
        dispatch(clearUser());
        const message = error.response?.data?.message || 'Registration failed';
        toast.error(message);
        throw error;
      }
    },
    [dispatch]
  );

  /**
   * Log out current user and clear sessions.
   */
  const logout = useCallback(async () => {
    dispatch(setLoading(true));
    try {
      await api.post('/auth/logout');
      dispatch(clearUser());
      toast.success('Logged out successfully');
    } catch (error: any) {
      dispatch(clearUser());
      toast.error('Error during logout');
    }
  }, [dispatch]);

  /**
   * Check authentication status and fetch profile on app mount.
   */
  const checkAuth = useCallback(async () => {
    dispatch(setLoading(true));
    try {
      const response = await api.get('/auth/me');
      const currentUser = response.data.data;
      dispatch(setUser(currentUser));
      return currentUser;
    } catch (error) {
      dispatch(clearUser());
      return null;
    }
  }, [dispatch]);

  return {
    user,
    isAuthenticated,
    isLoading,
    login,
    register,
    logout,
    checkAuth,
  };
};
